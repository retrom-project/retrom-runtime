package kirikiri

import "bytes"

// One bounded PE32 section-loader vocabulary. All constants and the dispatch order come from connected
// instructions; no native code is executed.

// wild matches any byte in a pattern.
const wild = -1

func matches(data view, at int, pattern []int, end int) bool {
	if at < 0 || at+len(pattern) > end {
		return false
	}
	for index, value := range pattern {
		if value != wild && data.at(at+index) != value {
			return false
		}
	}
	return true
}

func relative(data view, at, size int) int {
	if size == 2 {
		return at + size + data.i8(at+1)
	}
	return at + size + data.i32(at+size-4)
}

var loaderPrefix = []int{
	0x33, 0xc0, 0xb3, wild, 0xb2, wild, 0x80, 0x3c, 8, wild, 0x75, 25,
	0x80, 0x7c, 8, 1, wild, 0x75, 18, 0x38, 0x5c, 8, 2, 0x75, 12,
	0x38, 0x54, 8, 3, 0x75, 6, 0x38, 0x54, 8, 4, 0x74, 8, 0x40,
	0x3d, wild, wild, wild, wild, 0x72, 0xd9, 0x3d, wild, wild, wild, wild, 0x0f, 0x84,
	wild, wild, wild, wild, 0x8b, 0x74, 8, 12, 0x8b, 0x54, 8, 8, 3, 0xf1,
	0xbd, wild, wild, wild, wild, 0x2b, 0xee, 0x0f, 0x88, wild, wild, wild, wild,
	0x3b, 0xea, 0x0f, 0x8f, wild, wild, wild, wild, 0x33, 0xc0, 0x57, 0x85, 0xd2,
	0xbf, wild, wild, wild, wild, 0x0f, 0x86, wild, wild, wild, wild,
}

type loader struct {
	section      *section
	seed         uint32
	loop, finish int
}

func sectionLoader(data view, image *pe, at, end int) *loader {
	if !matches(data, at, loaderPrefix, end) {
		return nil
	}
	limit := int(data.u32(at + 39))
	name := []byte{data[at+9], data[at+16], data[at+3], data[at+5], data[at+5], 0, 0, 0}
	if limit == 0 || limit > 4096 || limit != int(data.u32(at+46)) {
		return nil
	}
	target := namedSection(data, image, name, limit)
	if target == nil {
		return nil
	}
	anchor, ok := image.fromVA(int(data.u32(at+67)), 1, 0)
	if !target.executable || target.virtualSize == 0 || target.virtualSize > target.size || !ok ||
		anchor < target.raw || anchor >= target.raw+target.virtualSize || at >= target.raw && at < target.end {
		return nil
	}
	finish := relative(data, at+97, 6)
	if !guardsLeave(data, at, finish, end) {
		return nil
	}
	return &loader{section: target, seed: data.u32(at + 93), loop: at + 103, finish: finish}
}

// guardsLeave: both the virtual-size guard and the anchor guard must leave this loop.
func guardsLeave(data view, at, finish, end int) bool {
	for _, guard := range []int{50, 73, 81} {
		if destination := relative(data, at+guard, 6); destination < finish || destination >= end {
			return false
		}
	}
	return true
}

// namedSection is the only section header carrying name within limit, also its first occurrence, or nil.
func namedSection(data view, image *pe, name []byte, limit int) *section {
	var found []*section
	for index := range image.sections {
		item := &image.sections[index]
		if item.header < limit && bytes.Equal(data.sub(item.header, item.header+8), name) {
			found = append(found, item)
		}
	}
	if len(found) != 1 || data.indexOf(name[:5], 0) != found[0].header {
		return nil
	}
	return found[0]
}

type recurrenceState struct {
	multiplier, increment uint32
	shift                 int
	tableVA               int
	fallback, dispatch    int
}

var recurrenceTail = []int{
	0x81, 0xc1, wild, wild, wild, wild, 0xc1, 0xef, wild,
	0x33, 0xf9, 0x8b, 0xcf, 0x83, 0xe1, 3, 0x83, 0xf9, 3, 0x77, wild, 0xff, 0x24, 0x8d,
	wild, wild, wild, wild,
}

// recurrence reduces the compiler's LEA/SHL/SUB chain to an affine coefficient.
func recurrence(data view, at, end int) *recurrenceState {
	if !matches(data, at, []int{0x8d, 0x0c, wild}, end) || data[at+2]&63 != 63 {
		return nil
	}
	multiplier := uint32(1 + 1<<(data[at+2]>>6))
	p := at + 3
	for range 16 {
		switch {
		case matches(data, p, []int{0xc1, 0xe1, wild}, end) && data[p+2] < 32:
			multiplier <<= data[p+2]
			p += 3
		case matches(data, p, []int{0xd1, 0xe1}, end):
			multiplier *= 2
			p += 2
		case matches(data, p, []int{0x2b, 0xcf}, end):
			multiplier--
			p += 2
		case matches(data, p, []int{0x8d, 0x0c, wild}, end) && data[p+2]&63 == 9:
			multiplier *= uint32(1 + 1<<(data[p+2]>>6))
			p += 3
		default:
			goto done
		}
	}
done:
	if multiplier == 0 || !matches(data, p, recurrenceTail, end) || data[p+8] < 1 || data[p+8] > 31 {
		return nil
	}
	return &recurrenceState{
		multiplier: multiplier, increment: data.u32(p + 2), shift: int(data[p+8]),
		tableVA: int(data.u32(p + 24)), fallback: relative(data, p+19, 2), dispatch: p + 21,
	}
}

type shiftResult struct{ bits, end int }

func byteShift(data view, at, operand, end int) *shiftResult {
	if matches(data, at, []int{0xd0, operand}, end) {
		return &shiftResult{1, at + 2}
	}
	if matches(data, at, []int{0xc0, operand, wild}, end) && data[at+2] > 0 && data[at+2] < 8 {
		return &shiftResult{int(data[at+2]), at + 3}
	}
	return nil
}

type permutationCase struct {
	table  [256]byte
	shared int
}

func bytePermutation(data view, at, end int) *permutationCase {
	if !matches(data, at, []int{0x8a, 0x0c, 0x30, 0x8a, 0xd9, 0x80}, end) {
		return nil
	}
	p := at + 8
	result := &permutationCase{}
	switch data.at(at + 6) {
	case 0xe1:
		right := byteShift(data, p, 0xeb, end)
		if right == nil || !matches(data, right.end, []int{0x80, 0xe3, wild}, end) {
			return nil
		}
		left := byteShift(data, right.end+3, 0xe1, end)
		if left == nil {
			return nil
		}
		low, high := int(data[at+7]), int(data[right.end+2])
		for value := range 256 {
			result.table[value] = byte((value&low)<<left.bits + (value>>right.bits)&high)
		}
		p = left.end
	case 0xe3:
		left := byteShift(data, p, 0xe3, end)
		if left == nil {
			return nil
		}
		right := byteShift(data, left.end, 0xe9, end)
		if right == nil {
			return nil
		}
		low := int(data[at+7])
		for value := range 256 {
			result.table[value] = byte((value&low)<<left.bits + value>>right.bits)
		}
		p = right.end
	default:
		return nil
	}
	seen := map[byte]bool{}
	for _, value := range result.table {
		seen[value] = true
	}
	if len(seen) != 256 {
		return nil
	}
	result.shared = p
	if matches(data, p, []int{0xeb, wild}, end) {
		result.shared = relative(data, p, 2)
	}
	return result
}

type sectionDecoder struct {
	*loader
	*recurrenceState
	cases []*permutationCase
	at    int
}

var sharedTail = []int{
	2, 0xd9, 0x88, 0x1c, 0x30, 0x3b, 0xc5, 0x75, 7,
	0x8a, 0x0c, 0x30, 0x88, 0x4c, 0x24, wild, 0x40, 0x3b, 0xc2, 0x0f, 0x82,
	wild, wild, wild, wild,
}

// decoderTargets reads four distinct executable jump-table targets inside [low, high), or nil.
func decoderTargets(data view, image *pe, table, low, high int) []int {
	targets := map[int]bool{}
	ordered := make([]int, 0, 4)
	for index := range 4 {
		target, valid := image.fromVA(int(data.u32(table+index*4)), 1, 1)
		if !valid || target < low || target >= high {
			return nil
		}
		targets[target] = true
		ordered = append(ordered, target)
	}
	if len(targets) != 4 {
		return nil
	}
	return ordered
}

// decoderCases decodes every byte-permutation case; all of them must share one tail.
func decoderCases(data view, ordered []int, end int) []*permutationCase {
	cases := make([]*permutationCase, len(ordered))
	shared := map[int]bool{}
	for index, target := range ordered {
		if cases[index] = bytePermutation(data, target, end); cases[index] == nil {
			return nil
		}
		shared[cases[index].shared] = true
	}
	if len(shared) != 1 {
		return nil
	}
	return cases
}

func decoderAt(data view, image *pe, at, end int) *sectionDecoder {
	found := sectionLoader(data, image, at, end)
	if found == nil {
		return nil
	}
	state := recurrence(data, found.loop, end)
	if state == nil {
		return nil
	}
	table, ok := image.fromVA(state.tableVA, 16, 0)
	if !ok || table < found.section.end && table+16 > found.section.raw {
		return nil
	}
	ordered := decoderTargets(data, image, table, state.dispatch+7, min(end, at+512))
	if ordered == nil {
		return nil
	}
	cases := decoderCases(data, ordered, end)
	if cases == nil {
		return nil
	}
	tail := cases[0].shared
	if !matches(data, tail, sharedTail, end) || relative(data, tail+19, 6) != found.loop || found.finish != tail+25 ||
		state.fallback != tail+5 {
		return nil
	}
	return &sectionDecoder{loader: found, recurrenceState: state, cases: cases, at: at}
}

// decodePESections statically decodes one recognized self-decoding section.
func decodePESections(data view, image *pe) (view, map[string]any) {
	var candidates []*sectionDecoder
	for _, item := range image.executableSections() {
		for at := item.raw; at+103 < item.end; at++ {
			if data[at] != 0x33 || data[at+1] != 0xc0 || data[at+2] != 0xb3 {
				continue
			}
			if value := decoderAt(data, image, at, item.end); value != nil {
				candidates = append(candidates, value)
			}
			if len(candidates) > 1 {
				return nil, nil
			}
		}
	}
	if len(candidates) != 1 {
		return nil, nil
	}
	value := candidates[0]
	output := append(view(nil), data...)
	state := value.seed
	for index := range value.section.virtualSize {
		state = (state*value.multiplier + value.increment) ^ (state >> value.shift)
		output[value.section.raw+index] = value.cases[state&3].table[data[value.section.raw+index]]
	}
	return output, map[string]any{
		"loaderVa": vaOf(image, value.at), "sectionRva": value.section.rva,
		"decodedBytes": value.section.virtualSize, "seed": value.seed, "multiplier": value.multiplier,
		"increment": value.increment, "stateShift": value.shift, "dispatchVa": vaOf(image, value.dispatch),
	}
}
