package normalize

import (
	"context"
	"encoding/binary"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
)

// wild matches any byte in a pattern.
const wild = -1

type bytesView []byte

func (b bytesView) at(index int) int {
	if index < 0 || index >= len(b) {
		return -1
	}
	return int(b[index])
}

func (b bytesView) u32(index int) uint32 {
	if index < 0 || index+4 > len(b) {
		panic(errRange)
	}
	return binary.LittleEndian.Uint32(b[index:])
}

func (b bytesView) u16(index int) int {
	if index < 0 || index+2 > len(b) {
		panic(errRange)
	}
	return int(binary.LittleEndian.Uint16(b[index:]))
}

func (b bytesView) i8(index int) int {
	if index < 0 || index >= len(b) {
		panic(errRange)
	}
	return int(int8(b[index]))
}

func (b bytesView) i32(index int) int {
	return int(int32(b.u32(index)))
}

func matchAt(data bytesView, at int, pattern []int) bool {
	if at < 0 || at+len(pattern) > len(data) {
		return false
	}
	for index, value := range pattern {
		if value != wild && int(data[at+index]) != value {
			return false
		}
	}
	return true
}

func findPattern(data bytesView, pattern []int, start, end int) []int {
	var positions []int
	for at := start; at+len(pattern) <= end; at++ {
		if matchAt(data, at, pattern) {
			positions = append(positions, at)
			requireMolebox(len(positions) <= 8, "RUNTIME_MOLEBOX_UNSUPPORTED")
		}
	}
	return positions
}

func callAt(data bytesView, at int) int {
	if data.at(at) == 0xe8 {
		return at + 5 + data.i32(at+1)
	}
	return -1
}

func one(values []int) int {
	requireMolebox(len(values) == 1, "RUNTIME_MOLEBOX_UNSUPPORTED")
	return values[0]
}

type peSection struct {
	raw, length, end, rva int
	executable            bool
}

type peLayout struct {
	imageBase int
	sections  []peSection
	overlay   int
}

func (p *peLayout) fromVA(va, length int) int {
	for _, item := range p.sections {
		if va >= p.imageBase+item.rva && va+length <= p.imageBase+item.rva+item.length {
			return item.raw + va - p.imageBase - item.rva
		}
	}
	return -1
}

// peHeaders32 reads the PE32 optional header and section table; it returns the header offset or -1.
func peHeaders32(ctx context.Context, handle *content.Handle, size int64) (bytesView, int64, int64, int64) {
	if size < 64 {
		return nil, 0, 0, -1
	}
	dos := bytesView(readAt(ctx, handle, size, 0, 64))
	if string(dos[:2]) != "MZ" {
		return nil, 0, 0, -1
	}
	offset := int64(dos.u32(60))
	if offset < 64 || offset > min(size-24, 1024*1024) {
		return nil, 0, 0, -1
	}
	head := bytesView(readAt(ctx, handle, size, offset, 24))
	count, optional := int64(head.u16(6)), int64(head.u16(20))
	if head.u32(0) != 0x4550 || head.u16(4) != 0x14c || count == 0 || count > 96 || optional < 64 || optional > 4096 ||
		offset+24+optional+count*40 > size {
		return nil, 0, 0, -1
	}
	rest := bytesView(readAt(ctx, handle, size, offset+24, optional+count*40))
	if rest.u16(0) != 0x10b {
		return nil, 0, 0, -1
	}
	return rest, optional, count, offset
}

func (s *peSection) overlaps(other *peSection) bool {
	return s.length != 0 && other.length != 0 && (s.raw < other.end && other.raw < s.end ||
		s.rva < other.rva+other.length && other.rva < s.rva+s.length)
}

// peSections parses non-overlapping file-backed section headers, or returns false.
func peSections(rest bytesView, optional, count, size int64, headerEnd int) ([]peSection, bool) {
	var sections []peSection
	for index := range int(count) {
		p := int(optional) + index*40
		raw, length, rva := int(rest.u32(p+20)), int(rest.u32(p+16)), int(rest.u32(p+12))
		if int64(raw) > size || int64(length) > size-int64(raw) || rva+length > 0x100000000 || length != 0 &&
			raw < headerEnd {
			return nil, false
		}
		current := peSection{
			raw: raw, length: length, end: raw + length, rva: rva,
			executable: rest.u32(p+36)&0x20000000 != 0,
		}
		for other := range sections {
			if current.overlaps(&sections[other]) {
				return nil, false
			}
		}
		sections = append(sections, current)
	}
	return sections, true
}

// overlayStart is the aligned end of the last file-backed section, which must also be the furthest; -1 otherwise.
func overlayStart(sections []peSection, alignment int) int {
	var backed []peSection
	for _, item := range sections {
		if item.length != 0 {
			backed = append(backed, item)
		}
	}
	if len(backed) == 0 {
		return -1
	}
	last := backed[len(backed)-1]
	for _, item := range backed {
		if item.end > last.end {
			return -1
		}
	}
	return (last.end + alignment - 1) / alignment * alignment
}

func readPELayout(ctx context.Context, handle *content.Handle, size int64) *peLayout {
	rest, optional, count, offset := peHeaders32(ctx, handle, size)
	if offset < 0 {
		return nil
	}
	alignment := int(rest.u32(36))
	if alignment < 512 || alignment > 65536 || alignment&(alignment-1) != 0 {
		return nil
	}
	sections, ok := peSections(rest, optional, count, size, int(offset+24+optional+count*40))
	if !ok {
		return nil
	}
	overlay := overlayStart(sections, alignment)
	if overlay < 0 || int64(overlay) > size {
		return nil
	}
	return &peLayout{imageBase: int(rest.u32(28)), sections: sections, overlay: overlay}
}

var substitutionPattern = []int{
	0x81, 0x7d, wild, 0, 1, 0, 0, 0x7d, wild, 0x8b, 0x45, wild, 0x83, 0xc0, 1, 0x99,
	0xb9, 31, 0, 0, 0, 0xf7, 0xf9, 0x8b, 0xca, 0xba, wild, wild, wild, wild, 0xd3, 0xfa,
	0x8b, 0x45, wild, 0x33, 0x14, 0x85, wild, wild, wild, wild, 0x8b, 0x4d, wild, 0x88, 0x91, wild, wild, wild,
	wild, 0xeb, wild,
}

type substitutionTable struct {
	at, raw int
	table   []byte
	mask    uint32
}

func substitution(data bytesView, layout *peLayout) []substitutionTable {
	var values []substitutionTable
	for _, item := range layout.sections {
		if !item.executable {
			continue
		}
		for _, at := range findPattern(data, substitutionPattern, item.raw, item.end) {
			if data[at+11] != data[at+2] || data[at+34] != data[at+2] || data[at+44] != data[at+2] ||
				at+53+data.i8(at+52) != at-9 {
				continue
			}
			raw := layout.fromVA(int(data.u32(at+38)), 1024)
			if raw < 0 {
				continue
			}
			mask := data.u32(at + 26)
			table := make([]byte, 256)
			seen := map[byte]bool{}
			for index := range 256 {
				table[index] = data[raw+4*index] ^ byte(int32(mask)>>((index+1)%31))
				seen[table[index]] = true
			}
			if len(seen) == 256 {
				values = append(values, substitutionTable{at: at, raw: raw, table: table, mask: mask})
			}
		}
	}
	return values
}

var headerPattern = []int{
	0x8b, 0x55, wild, 0x81, 0xc2, wild, wild, wild, wild, 0x52, 0x8b, 0x45, wild, 0x83, 0xc0, 24,
	0x50, 0xe8, wild, wild, wild, wild, 0x83, 0xc4, 8, 0x6a, wild, 0x8b, 0x4d, wild, 0x51, 0x8b, 0x55, wild,
	0x83, 0xc2, 24, 0x52, 0xe8, wild, wild, wild, wild, 0x83, 0xc4, 12, 0x6a, wild, 0x8b, 0x45, wild, 5,
	wild, wild, wild, wild, 0x50, 0x8b, 0x4d, wild, 0x83, 0xc1, 24, 0x51, 0xe8, wild, wild, wild, wild,
}

type headerLayout struct {
	at, seedOffset, firstBytes, secondOffset, secondBytes int
}

func headerSchema(data bytesView, layout *peLayout) []headerLayout {
	var result []headerLayout
	for _, item := range layout.sections {
		if !item.executable {
			continue
		}
		for _, at := range findPattern(data, headerPattern, item.raw, item.end) {
			if data[at+2] != data[at+29] || data[at+2] != data[at+50] || callAt(data, at+38) != callAt(data, at+64) {
				continue
			}
			valid := true
			for _, p := range []int{17, 38} {
				target := callAt(data, at+p)
				inside := false
				for _, other := range layout.sections {
					inside = inside || other.executable && target >= other.raw && target < other.end
				}
				valid = valid && inside
			}
			if valid {
				result = append(result, headerLayout{
					at: at, seedOffset: int(data.u32(at + 5)), firstBytes: int(data[at+26]) * 8,
					secondOffset: int(data.u32(at + 52)), secondBytes: int(data[at+47]) * 8,
				})
			}
		}
	}
	return result
}

type sourceLayout struct {
	headerLayout
	substitutionTable
	headerBytes, stageField int
	magic                   uint32
}

var (
	magicPattern = []int{
		0x8b, 0x55, wild, 0x81, 0xf2, wild, wild, wild, wild, 0x33, 0x55, wild,
		0x81, 0xfa, wild, wild, wild, wild, 0x74, 6, 0xb9, wild, wild, wild, wild, 0xcc,
	}
	fieldPattern = []int{
		0x8b, 0x55, wild, 0x8b, 0x42, wild, 0x89, 0x45, wild, 0x8b, 0x4d, wild,
		0x8b, 0x51, wild, 0x52, 0x8b, 0x45, wild, 0x50, 0xe8, wild, wild, wild, wild, 0x83, 0xc4, 8,
	}
)

func near(positions []int, at int, test func(int) bool) []int {
	var result []int
	for _, p := range positions {
		if abs(p-at) < 4096 && test(p) {
			result = append(result, p)
		}
	}
	return result
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func sourceSchema(data bytesView, layout *peLayout) *sourceLayout {
	tables, schemas := substitution(data, layout), headerSchema(data, layout)
	if len(tables) == 0 && len(schemas) == 0 {
		return nil
	}
	requireMolebox(len(tables) > 0 && len(schemas) > 0, "RUNTIME_MOLEBOX_UNSUPPORTED")
	table, header := tables[0], schemas[0]
	requireMolebox(len(tables) == 1 && len(schemas) == 1, "RUNTIME_MOLEBOX_UNSUPPORTED")
	magic := one(near(findPattern(data, magicPattern, 0, len(data)), header.at, func(int) bool { return true }))
	fields := one(near(findPattern(data, fieldPattern, 0, len(data)), header.at, func(p int) bool {
		return int(data[p+5]) == int(data[p+14])+4
	}))
	size := header.secondOffset + header.secondBytes
	requireMolebox(header.firstBytes > 0 && header.firstBytes <= header.seedOffset &&
		header.seedOffset+15 <= header.secondOffset &&
		size >= 492 && size <= 4096 && int(data[fields+14])+8 <= header.firstBytes, "RUNTIME_MOLEBOX_UNSUPPORTED")
	return &sourceLayout{
		headerLayout: header, substitutionTable: table, headerBytes: size, stageField: int(data[fields+14]),
		magic: data.u32(magic+5) ^ data.u32(magic+14),
	}
}

var stringPattern = []int{
	0x8b, 0x74, 0x24, wild, 0xb8, wild, wild, wild, wild, 0x31, 0xc6, 0x29, 0xc6, 0x81, 0xe6, 255, 255, 0, 0,
	0x8d, 0xb6, wild, wild, wild, wild, 0x8b, 0x4c, 0x24, wild, 0x8b, 6, 0x46, 0x57, 0x8a, 0x26, 0x30, 0xc4,
	0x88, 0x27, 0x46, 0xd0, 0xc8, 0x47, 0x49, 0x75, 0xf3, 0x58, 0x59, 0x5f, 0x5e, 0xc3,
}

func stringParameters(stage bytesView, target, imageBase int) (int, uint32) {
	at := one(findPattern(stage, stringPattern, max(0, target), min(len(stage), target+128)))
	base := int(stage.u32(at+21)) - imageBase
	requireMolebox(base >= 0 && base < len(stage), "RUNTIME_MOLEBOX_UNSUPPORTED")
	return base, stage.u32(at + 5)
}

var passwordPattern = []int{
	0x6a, wild, 0x68, wild, wild, wild, wild, 0x8b, 0xf1, 0xe8, wild, wild, wild, wild,
	0x8b, 0xf8, 0x8d, 0x45, wild, 0x50, 0x57, 0xe8, wild, wild, wild, wild, 0x57, 0xe8, wild, wild, wild, wild,
	0x83, 0xc4, 20, 0x8d, 0x4d, wild, 0x51, 0x8d, 0x8d, wild, wild, wild, wild, 0xe8, wild, wild, wild, wild,
}

func catalogPassword(stage bytesView, imageBase int) []byte {
	at := one(findPattern(stage, passwordPattern, 0, len(stage)))
	base, scramble := stringParameters(stage, callAt(stage, at+9), imageBase)
	length, token := int(stage[at+1]), stage.u32(at+3)
	offset := base + int(((token^scramble)-scramble)&65535)
	requireMolebox(length >= 2 && length <= 128)
	encoded := moleboxRange(stage, int64(offset), int64(length+1))
	password := make([]byte, length)
	state := encoded[0]
	for index := range length {
		password[index] = encoded[index+1] ^ state
		state = state>>1 | (state&1)<<7
	}
	requireMolebox(password[length-1] == 0)
	for _, value := range password[:length-1] {
		requireMolebox(value != 0)
	}
	return password[:length-1]
}

type loaderParameters struct {
	catalogOffset int64
	password      []byte
}

var (
	fieldLoad    = []int{0x8b, 0x86, wild, wild, wild, wild, 0x8b, 0x8e, wild, wild, wild, wild, 0x89, 0x45, wild}
	encodedFlags = []int{0xf7, 0x46, 4, 0, 0x80, 0, 0}
)

func stageParameters(stage, header bytesView) loaderParameters {
	requireMolebox(len(stage) >= 52 && string(stage[:8]) == "STEELBOX" && stage.u32(8) == 0x893,
		"RUNTIME_MOLEBOX_UNSUPPORTED")
	imageBase, entry := int(stage.u32(28)), int(stage.u32(36))
	requireMolebox(entry >= 52 && entry < len(stage) && imageBase+len(stage) <= 0x100000000)
	positions := findPattern(stage, fieldLoad, entry, min(entry+160, len(stage)))
	field := int(stage.u32(one(positions) + 2))
	requireMolebox(field >= 0 && field+8 <= len(header) && int(stage.u32(positions[0]+8)) == field+4)
	marker := findPattern(stage, encodedFlags, entry, min(entry+128, len(stage)))
	requireMolebox(len(marker) == 1 && header.u32(4)&0x8000 != 0, "RUNTIME_MOLEBOX_UNSUPPORTED")
	return loaderParameters{catalogOffset: int64(header.u32(field)), password: catalogPassword(stage, imageBase)}
}

type moleboxLoader struct {
	loaderParameters
	table     []byte
	dataStart int64
	evidence  map[string]any
}

func readMoleboxLoader(ctx context.Context, handle *content.Handle, size int64) *moleboxLoader {
	layout := readPELayout(ctx, handle, size)
	if layout == nil || size-int64(layout.overlay) < 8 {
		return nil
	}
	// A PE image beyond the bounded static recognition window is not a matched container.
	if layout.overlay > moleboxImage {
		return nil
	}
	data := bytesView(readAt(ctx, handle, size, 0, int64(layout.overlay)))
	schema := sourceSchema(data, layout)
	if schema == nil {
		return nil
	}
	marker := bytesView(readAt(ctx, handle, size, int64(layout.overlay), 8))
	requireMolebox(marker.u32(0)^marker.u32(4) == schema.magic)
	raw := readAt(ctx, handle, size, int64(layout.overlay)+8, int64(schema.headerBytes))
	key := moleboxKey(moleboxRange(raw, int64(schema.seedOffset), 15))
	header := bytesView(append([]byte(nil), raw...))
	copy(header, decodeMolebox(raw[:schema.firstBytes], key, schema.table, true))
	copy(header[schema.secondOffset:], decodeMolebox(raw[schema.secondOffset:], key, schema.table, true))
	flags := header.u32(4)
	requireMolebox(header.u32(20) == 0 && header.u32(60) == 0 && flags&0x20000 == 0,
		"RUNTIME_MOLEBOX_INJECTION_UNSUPPORTED")
	requireMolebox(flags&0x10 != 0 && flags&0x80000000 == 0, "RUNTIME_MOLEBOX_UNSUPPORTED")
	stageOffset, packed := int64(header.u32(schema.stageField)), int64(header.u32(schema.stageField+4))
	requireMolebox(stageOffset >= int64(layout.overlay)+8+int64(len(raw)) && packed > 0 && packed%8 == 0)
	requireMolebox(packed <= moleboxStage, "RUNTIME_MOLEBOX_LIMIT")
	encoded := readAt(ctx, handle, size, stageOffset, packed)
	stage := unpackMoleboxStage(ctx, decodeMolebox(encoded, key, schema.table, true))
	parameters := stageParameters(stage, header)
	return &moleboxLoader{
		loaderParameters: parameters, table: schema.table, dataStart: stageOffset + packed,
		evidence: map[string]any{
			"kind": "molebox4-steelbox", "overlayOffset": layout.overlay, "loaderTableOffset": schema.raw,
			"stageOffset": stageOffset, "stageBytes": len(stage),
		},
	}
}
