package kirikiri

import (
	"bytes"
	"compress/zlib"
	"io"
)

const (
	maxModuleBytes = 64 * 1024 * 1024
	maxCandidates  = 32
)

// section is one PE32 section header.
type section struct {
	raw, size, end, rva, header, virtualSize int
	executable                               bool
}

// pe is a parsed PE32 image used as data only.
type pe struct {
	data      view
	sections  []section
	imageBase int
}

func moduleBytes(input []byte) view {
	if len(input) > maxModuleBytes {
		panic(internal("CX_MODULE_LIMIT: module exceeds 64 MiB"))
	}
	return input
}

// peSections locates the section table of a PE32 i386 image, or reports false.
func peSections(data view) (int, int, int, bool) {
	if len(data) < 64 || data.ascii(0, 2) != "MZ" {
		return 0, 0, 0, false
	}
	at := int(data.u32(60))
	if at > len(data)-24 || data.u32(at) != 0x4550 || data.u16(at+4) != 0x14c {
		return 0, 0, 0, false
	}
	count, optional, header := data.u16(at+6), data.u16(at+20), at+24
	if count == 0 || count > 96 || optional < 64 || header+optional+count*40 > len(data) || data.u16(header) != 0x10b {
		return 0, 0, 0, false
	}
	return header, optional, count, true
}

func (s *section) overlaps(other *section) bool {
	return s.size != 0 && other.size != 0 && (s.rva < other.rva+other.size && other.rva < s.rva+s.size ||
		s.raw < other.raw+other.size && other.raw < s.raw+s.size)
}

func parsePE(data view) *pe {
	header, optional, count, ok := peSections(data)
	if !ok {
		return nil
	}
	image := &pe{data: data, imageBase: int(data.u32(header + 28))}
	for index := range count {
		position := header + optional + index*40
		size, raw, rva := int(data.u32(position+16)), int(data.u32(position+20)), int(data.u32(position+12))
		if raw+size > len(data) || rva+size > 0x100000000 || raw < header+optional+count*40 && size != 0 {
			return nil
		}
		current := section{
			raw: raw, size: size, end: raw + size, rva: rva, header: position,
			virtualSize: int(data.u32(position + 8)), executable: data.u32(position+36)&0x20000000 != 0,
		}
		for other := range image.sections {
			if current.overlaps(&image.sections[other]) {
				return nil
			}
		}
		image.sections = append(image.sections, current)
	}
	return image
}

func (p *pe) sectionAt(offset int) *section {
	for index := range p.sections {
		if offset >= p.sections[index].raw && offset < p.sections[index].end {
			return &p.sections[index]
		}
	}
	return nil
}

// sectionEnd is the end of the section containing offset, or 0; every bounded slice ending there is then empty.
func (p *pe) sectionEnd(offset int) int {
	found := p.sectionAt(offset)
	if found == nil {
		return 0
	}
	return found.end
}

func (p *pe) toVA(offset int) (int, bool) {
	found := p.sectionAt(offset)
	if found == nil {
		return 0, false
	}
	return p.imageBase + found.rva + offset - found.raw, true
}

// executable is a tri-state filter: 0 any, 1 executable, -1 data.
func (p *pe) fromVA(va, size, executable int) (int, bool) {
	for index := range p.sections {
		item := &p.sections[index]
		if va >= p.imageBase+item.rva && va+size <= p.imageBase+item.rva+item.size {
			if executable == 0 || item.executable == (executable > 0) {
				return item.raw + va - p.imageBase - item.rva, true
			}
			return 0, false
		}
	}
	return 0, false
}

func (p *pe) callTarget(offset int) (int, bool) {
	if offset < 0 || offset+5 > len(p.data) || p.data[offset] != 0xe8 {
		return 0, false
	}
	va, ok := p.toVA(offset)
	if !ok {
		return 0, false
	}
	return p.fromVA(va+5+p.data.i32(offset+1), 1, 1)
}

func (p *pe) executableSections() []section {
	var result []section
	for _, item := range p.sections {
		if item.executable {
			result = append(result, item)
		}
	}
	return result
}

func (p *pe) dataSections() []section {
	var result []section
	for _, item := range p.sections {
		if !item.executable {
			result = append(result, item)
		}
	}
	return result
}

// IsPEModule reports a parsable PE32 image.
func IsPEModule(data []byte) bool { return parsePE(moduleBytes(data)) != nil }

var internalModule = []byte("internal module\x00")

// zlibHeader reports a deflate zlib header with a valid check value.
func zlibHeader(data view, z int) bool {
	return data[z]&15 == 8 && data[z]>>4 <= 7 && (int(data[z])<<8+int(data[z+1]))%31 == 0
}

// embeddedModule inflates the first valid PE stream of one record, charging every declared expansion to remaining.
func embeddedModule(data view, start int, remaining *int) []byte {
	end := min(len(data)-2, start+256)
	for z := start + 8; z < end; z++ {
		if !zlibHeader(data, z) {
			continue
		}
		expanded, packed := int(data.u32(z-8)), int(data.u32(z-4))
		if expanded == 0 || expanded > maxModuleBytes || packed < 2 || packed > maxModuleBytes || z+packed > len(data) {
			continue
		}
		// Declared bytes are reserved before any zlib allocation; exceeding the budget is never a skipped record.
		if expanded > *remaining {
			panic(internal("CX_MODULE_LIMIT: cumulative embedded expansion exceeds budget"))
		}
		*remaining -= expanded
		if inflated := inflateModule(data[z:z+packed], expanded); inflated != nil && parsePE(inflated) != nil {
			return inflated
		}
	}
	return nil
}

// extractEmbeddedPEModules returns independent PE buffers; cumulative expansion is capped before each inflate.
func extractEmbeddedPEModules(input []byte, budget int) [][]byte {
	data := moduleBytes(input)
	if budget < 0 {
		panic(internal("CX_MODULE_LIMIT: invalid embedded expansion budget"))
	}
	remaining := min(budget, maxModuleBytes)
	var modules [][]byte
	for cursor, records := 0, 0; cursor < len(data); {
		at := data.indexOf(internalModule, cursor)
		if at < 0 {
			break
		}
		records++
		if records > maxCandidates {
			panic(internal("CX_MODULE_LIMIT: too many embedded module records"))
		}
		if module := embeddedModule(data, at+len(internalModule), &remaining); module != nil {
			modules = append(modules, module)
		}
		cursor = at + len(internalModule)
	}
	return modules
}

// inflateModule returns a complete zlib stream that inflates to exactly expanded bytes, or nil.
func inflateModule(data []byte, expanded int) []byte {
	reader := bytes.NewReader(data)
	decoder, err := zlib.NewReader(reader)
	if err != nil {
		return nil
	}
	result, err := io.ReadAll(io.LimitReader(decoder, int64(expanded)+1))
	if err != nil || len(result) != expanded || reader.Len() != 0 {
		return nil
	}
	return result
}
