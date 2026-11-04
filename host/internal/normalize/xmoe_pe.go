package normalize

import (
	"context"
	"encoding/binary"
	"sort"
)

func xmoeFind(data bytesView, pattern []int, start, end int) []int {
	anchorLength := len(pattern)
	for index, value := range pattern {
		if value == wild {
			anchorLength = index
			break
		}
	}
	requireXmoe(anchorLength > 0)
	anchor := make([]byte, anchorLength)
	for index := range anchor {
		anchor[index] = byte(pattern[index])
	}
	var result []int
	for at := start; ; at++ {
		at = indexFrom(data, anchor, at)
		if at < 0 || at+len(pattern) > end {
			break
		}
		if matchAt(data, at, pattern) {
			result = append(result, at)
			requireXmoe(len(result) <= 16, "RUNTIME_XMOE_UNSUPPORTED")
		}
	}
	return result
}

func xmoeOne(values []int) int {
	requireXmoe(len(values) == 1, "RUNTIME_XMOE_UNSUPPORTED")
	return values[0]
}

type xmoeSection struct {
	raw, length, rva int
	executable       bool
}

type xmoeLayout struct {
	base      int
	sections  []xmoeSection
	exportRVA int
}

func (l *xmoeLayout) fromVA(va, length int) int {
	for _, item := range l.sections {
		if va >= l.base+item.rva && va+length <= l.base+item.rva+item.length {
			return item.raw + va - l.base - item.rva
		}
	}
	return -1
}

func (l *xmoeLayout) toVA(at int) int {
	for _, item := range l.sections {
		if at >= item.raw && at < item.raw+item.length {
			return l.base + item.rva + at - item.raw
		}
	}
	return -1
}

func readXmoeLayout(data bytesView) *xmoeLayout {
	if len(data) < 64 || string(data[:2]) != "MZ" {
		return nil
	}
	offset := int(data.u32(60))
	if offset < 64 || offset > min(len(data)-24, 1024*1024) {
		return nil
	}
	count, optional, start := data.u16(offset+6), data.u16(offset+20), offset+24
	if data.u32(offset) != 0x4550 || data.u16(offset+4) != 0x14c || count == 0 || count > 96 || optional < 104 ||
		start+optional+count*40 > len(data) || data.u16(start) != 0x10b {
		return nil
	}
	layout := &xmoeLayout{base: int(data.u32(start + 28)), exportRVA: int(data.u32(start + 96))}
	tableEnd := start + optional + count*40
	for p := start + optional; p < tableEnd; p += 40 {
		current := xmoeSection{
			raw: int(data.u32(p + 20)), length: int(data.u32(p + 16)), rva: int(data.u32(p + 12)),
			executable: data.u32(p+36)&0x20000000 != 0,
		}
		if !layout.admits(&current, len(data), tableEnd) {
			return nil
		}
		layout.sections = append(layout.sections, current)
	}
	return layout
}

// admits checks a section's file bounds and that it overlaps no earlier section in the file or in memory.
func (l *xmoeLayout) admits(s *xmoeSection, size, tableEnd int) bool {
	if s.raw > size || s.length > size-s.raw || l.base+s.rva+s.length > 0x100000000 || s.length != 0 && s.raw < tableEnd {
		return false
	}
	for _, other := range l.sections {
		if s.length != 0 && other.length != 0 && (s.raw < other.raw+other.length && other.raw < s.raw+s.length ||
			s.rva < other.rva+other.length && other.rva < s.rva+s.length) {
			return false
		}
	}
	return true
}

func (l *xmoeLayout) executable() []xmoeSection {
	var result []xmoeSection
	for _, item := range l.sections {
		if item.executable {
			result = append(result, item)
		}
	}
	return result
}

func sectionsFind(data bytesView, sections []xmoeSection, pattern []int) []int {
	result := make([]int, 0, len(sections))
	for _, item := range sections {
		result = append(result, xmoeFind(data, pattern, item.raw, item.raw+item.length)...)
	}
	return result
}

var (
	payloadLoop = []int{
		0x8b, 0x56, 4, 0x8b, 0xc8, 0x81, 0xe1, wild, wild, wild, wild, 0x8a, 0x89, wild, wild, wild, wild,
		0x30, 0x0c, 2, 0x40, 0x3b, 6, 0x72, 0xe7, 0x53, 0x57, 0x8b, 0x7e, 4, 0x81, 0x3f, wild, wild, wild, wild,
	}
	headerXorPattern = []int{
		0x8b, 0x85, wild, wild, wild, wild, 0x81, 0xb5, wild, wild, wild, wild, wild, wild, wild, wild, 0x35,
		wild, wild, wild, wild, 0x81, 0xb5, wild, wild, wild, wild, wild, wild, wild, wild, 0x81, 0xb5, wild, wild,
		wild, wild, wild,
		wild, wild, wild,
	}
	openPattern = []int{
		0x6a, 0, 0x68, 0x80, 0, 0, 0, 0x6a, 3, 0x6a, 0, 0x6a, 1, 0x68, 0, 0, 0, 0x80, 0x68, wild,
		wild, wild, wild,
	}
	textPattern = []int{
		0x8a, 0x81, wild, wild, wild, wild, 0xc0, 0xc8, wild, 0x88, 0x81, wild, wild, wild, wild, 0x41, 0x3b, 0xca,
		0x72, 0xec,
	}
	lz4Pattern  = []int{0x0f, 0xb6, 0x1e, 0x46, 0x89, 0x5d, wild, 0xc1, 0xeb, 4, 0x83, 0xfb, 15}
	hashPattern = []int{
		0x55, 0x8b, 0xec, 0x83, 0xec, 8, 0x53, 0x56, 0x8b, 0xda, 0x8b, 0xf1, 0x57, 0x81, 0xf3, wild, wild, wild,
		wild, 0x33, 0xff, 0x89, 0x5d, 0xfc, 0x83, 0xfa, 8,
	}
)

type headerParameters struct {
	archiveName                 string
	packed, raw, count, version uint32
	at, open                    int
}

func xmoeHeaderParameters(data bytesView, layout *xmoeLayout, sections []xmoeSection) *headerParameters {
	var candidates []int
	for _, p := range sectionsFind(data, sections, headerXorPattern) {
		raw := data.i32(p + 2)
		if data.i32(p+8) == raw-4 && data.i32(p+23) == raw-8 && data.i32(p+33) == raw-16 {
			candidates = append(candidates, p)
		}
	}
	at := xmoeOne(candidates)
	open := xmoeOne(xmoeFind(data, openPattern, max(0, at-256), at))
	nameAt := layout.fromVA(int(data.u32(open+19)), 2)
	requireXmoe(nameAt >= 0)
	end := nameAt
	for end+2 <= len(data) && end-nameAt <= xmoeNameMax*2 && data.u16(end) != 0 {
		end += 2
	}
	requireXmoe(end+2 <= len(data) && data.u16(end) == 0)
	requireXmoe(layout.fromVA(int(data.u32(open+19)), end-nameAt+2) == nameAt)
	return &headerParameters{
		archiveName: xmoeName(data[nameAt:end]), packed: data.u32(at + 12), raw: data.u32(at + 17),
		count: data.u32(at + 27), version: data.u32(at + 37), at: at, open: open,
	}
}

type textParameters struct {
	rotation               int
	startMarker, endMarker uint32
	at                     int
}

func xmoeTextParameters(data bytesView, sections []xmoeSection) *textParameters {
	var candidates []int
	for _, p := range sectionsFind(data, sections, textPattern) {
		if data.u32(p+2) == data.u32(p+11) {
			candidates = append(candidates, p)
		}
	}
	at := xmoeOne(candidates)
	markers := xmoeFind(data, []int{0x83, 0x3c, 0x37, wild}, max(0, at-256), at)
	requireXmoe(len(markers) == 2)
	rotation := int(data[at+8])
	start, end := uint32(int32(data.i8(markers[0]+3))), uint32(int32(data.i8(markers[1]+3)))
	requireXmoe(rotation >= 1 && rotation <= 7 && start >= 0xffffff80 && end >= 0xffffff80 && start != end,
		"RUNTIME_XMOE_UNSUPPORTED")
	return &textParameters{rotation: rotation, startMarker: start, endMarker: end, at: at}
}

func xmoeStaticProfile(data bytesView, layout *xmoeLayout) *xmoeProfile {
	sections := layout.executable()
	loops := sectionsFind(data, sections, payloadLoop)
	if len(loops) == 0 {
		return nil
	}
	loop := xmoeOne(loops)
	mask := int(data.u32(loop + 7))
	keyAt := layout.fromVA(int(data.u32(loop+13)), mask+1)
	requireXmoe(mask >= 15 && mask < 65536 && mask&(mask+1) == 0 && keyAt >= 0, "RUNTIME_XMOE_UNSUPPORTED")
	requireXmoe(data.at(loop+80) == 0xe8, "RUNTIME_XMOE_UNSUPPORTED")
	lz4 := layout.fromVA(layout.toVA(loop+80)+5+data.i32(loop+81), 256)
	requireXmoe(lz4 >= 0 && len(xmoeFind(data, lz4Pattern, lz4, lz4+256)) == 1, "RUNTIME_XMOE_UNSUPPORTED")
	hash := xmoeOne(sectionsFind(data, sections, hashPattern))
	requireXmoe(len(xmoeFind(data, []int{0x95, 0xe9, 0xd1, 0x5b}, hash, min(hash+256, len(data)))) >= 2,
		"RUNTIME_XMOE_UNSUPPORTED")
	header, text := xmoeHeaderParameters(data, layout, sections), xmoeTextParameters(data, sections)
	return &xmoeProfile{
		archiveName: header.archiveName, packedXor: header.packed, rawXor: header.raw, countXor: header.count,
		versionXor: header.version, rotation: text.rotation, startMarker: text.startMarker, endMarker: text.endMarker,
		hashSeed: data.u32(hash + 15), payloadMagic: data.u32(loop + 32), key: append([]byte(nil), xmoeRange(data,
			int64(keyAt), int64(mask+1))...),
		evidence: map[string]any{
			"kind": "xmoe-static-companion", "payloadLoop": layout.toVA(loop), "key": layout.toVA(keyAt),
			"header": layout.toVA(header.at), "archiveOpen": layout.toVA(header.open), "text": layout.toVA(text.at),
			"hash": layout.toVA(hash), "lz4": layout.toVA(lz4),
		},
	}
}

func exportedSections(data bytesView, layout *xmoeLayout) []xmoeSection {
	at := layout.fromVA(layout.base+layout.exportRVA, 40)
	if layout.exportRVA == 0 || at < 0 {
		return nil
	}
	count := int(data.u32(at + 20))
	if count == 0 || count > 4096 {
		return nil
	}
	table := layout.fromVA(layout.base+int(data.u32(at+28)), count*4)
	if table < 0 {
		return nil
	}
	var filtered []xmoeSection
	seen := map[int]bool{}
	for index := range count {
		position := layout.executableAt(int(data.u32(table + index*4)))
		if position < 0 || seen[position] {
			continue
		}
		seen[position] = true
		if item := layout.sections[position]; item.length >= 256 && item.length <= 4*1024*1024 && item.length%4 == 0 {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

// executableAt is the first executable section containing rva, or -1.
func (l *xmoeLayout) executableAt(rva int) int {
	for position, item := range l.sections {
		if item.executable && rva >= item.rva && rva < item.rva+item.length {
			return position
		}
	}
	return -1
}

// safeProfile evaluates a candidate representation; any failure is retained, as the source catches every error.
func safeProfile(data bytesView, layout *xmoeLayout) (*xmoeProfile, error) {
	return guarded(func() (*xmoeProfile, error) { return safeProfileUnguarded(data, layout) })
}

func safeProfileUnguarded(data bytesView, layout *xmoeLayout) (*xmoeProfile, error) {
	return xmoeStaticProfile(data, layout), nil
}

// probeXmoeCompanion: packed section modal words are bounded candidate subtraction values; a candidate becomes
// a profile only after every independent routine/table/address relation agrees. No PE instruction is executed.
func probeXmoeCompanion(ctx context.Context, input []byte) *xmoeProfile {
	checkCancel(ctx)
	if len(input) > xmoeImage {
		return nil
	}
	data := bytesView(append([]byte(nil), input...))
	layout := readXmoeLayout(data)
	if layout == nil {
		return nil
	}
	if direct := xmoeStaticProfile(data, layout); direct != nil {
		direct.evidence["bodyTransform"] = nil
		return direct
	}
	var found []*xmoeProfile
	var failure error
	for _, item := range exportedSections(data, layout) {
		for _, key := range candidateKeys(data, item) {
			checkCancel(ctx)
			decoded := bytesView(append([]byte(nil), data...))
			for at := item.raw; at < item.raw+item.length; at += 4 {
				binary.LittleEndian.PutUint32(decoded[at:], data.u32(at)-key)
			}
			value, err := safeProfile(decoded, layout)
			if err != nil {
				failure = err
				continue
			}
			if value != nil {
				value.evidence["bodyTransform"] = map[string]any{
					"kind":       "inferred-u32-subtract",
					"sectionRva": item.rva, "key": key,
				}
				found = append(found, value)
			}
		}
	}
	if len(found) == 0 && failure != nil {
		panic(failure)
	}
	if len(found) == 0 {
		return nil
	}
	requireXmoe(len(found) == 1, "RUNTIME_XMOE_UNSUPPORTED")
	return found[0]
}

func candidateKeys(data bytesView, item xmoeSection) []uint32 {
	type entry struct {
		word  uint32
		count int
		order int
	}
	histogram := map[uint32]*entry{}
	var order []*entry
	for at := item.raw; at < item.raw+item.length; at += 4 {
		word := data.u32(at)
		if histogram[word] == nil {
			histogram[word] = &entry{word: word, order: len(order)}
			order = append(order, histogram[word])
		}
		histogram[word].count++
	}
	sort.SliceStable(order, func(i, j int) bool { return order[i].count > order[j].count })
	var keys []uint32
	seen := map[uint32]bool{}
	for _, value := range order[:min(2, len(order))] {
		if value.count < 16 {
			continue
		}
		for _, key := range []uint32{value.word, value.word - 0xcccccccc, value.word - 0x90909090} {
			if !seen[key] {
				seen[key] = true
				keys = append(keys, key)
			}
		}
	}
	return keys
}
