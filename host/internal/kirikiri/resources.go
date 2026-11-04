package kirikiri

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"hash"
	"hash/crc32"
	"regexp"
	"strings"
	"unicode"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

type stageState struct {
	Stage
	checksum uint32
	hash     hash.Hash
	sha256   string
}

func stageStates(filter *Filter) []*stageState {
	require(len(filter.Stages) > 0 && len(filter.Stages) <= 2, "FILTER_AMBIGUOUS")
	states := make([]*stageState, len(filter.Stages))
	for index, stage := range filter.Stages {
		states[index] = &stageState{Stage: stage, checksum: 1, hash: sha256.New()}
	}
	return states
}

func updateStages(states []*stageState, raw []byte, seed uint32, offset int64) {
	for _, state := range states {
		data := append([]byte(nil), raw...)
		state.Apply(data, seed, offset)
		state.checksum = adler32(data, state.checksum)
		state.hash.Write(data)
	}
}

func selectStage(states []*stageState, expected uint32) *stageState {
	var matched []*stageState
	digests := map[string]bool{}
	for _, state := range states {
		state.sha256 = hex.EncodeToString(state.hash.Sum(nil))
		if state.checksum == expected {
			matched = append(matched, state)
			digests[state.sha256] = true
		}
	}
	require(len(digests) <= 1, "FILTER_AMBIGUOUS")
	if len(matched) == 0 {
		return nil
	}
	return matched[0]
}

// probeStage authenticates complete bytes, including the filter's actual native stages.
func probeStage(filter *Filter, data []byte, seed, checksum uint32) bool {
	states := stageStates(filter)
	updateStages(states, data, seed, 0)
	return selectStage(states, checksum) != nil
}

type selectedStage struct {
	*stageState
	rawSHA256 string
}

// selectResourceStage selects one source-checksummed representation with bounded memory.
func selectResourceStage(ctx context.Context, locator *content.Locator, entry *Entry, filter *Filter) *selectedStage {
	states, raw, size := stageStates(filter), sha256.New(), int64(0)
	resourceBytes(ctx, locator, entry, func(data []byte) {
		raw.Write(data)
		updateStages(states, data, entry.H, size)
		size += int64(len(data))
	})
	require(size == entry.Size && entry.Readable == entry.Size, "CHECKSUM_MISMATCH")
	selected := selectStage(states, entry.Adler)
	require(selected != nil, "CHECKSUM_MISMATCH")
	return &selectedStage{stageState: selected, rawSHA256: hex.EncodeToString(raw.Sum(nil))}
}

var pngSignature = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}

func validPNG(data view) bool {
	if !bytes.HasPrefix(data, pngSignature) {
		return false
	}
	first := true
	for at := 8; at < len(data); {
		if at+12 > len(data) {
			return false
		}
		size := int(data.u32be(at))
		end := at + 12 + size
		if end > len(data) || end < at || crc32.ChecksumIEEE(data[at+4:end-4]) != data.u32be(end-4) {
			return false
		}
		tag := data.ascii(at+4, at+8)
		if first && (tag != "IHDR" || size != 13 || data.u32be(at+8) == 0 || data.u32be(at+12) == 0) {
			return false
		}
		first = false
		if tag == "IEND" {
			return size == 0 && end == len(data)
		}
		at = end
	}
	return false
}

// oggCRC is the Ogg page checksum with the stored checksum field read as zero.
func oggCRC(data view, at, end int) uint32 {
	crc := uint32(0)
	for index := at; index < end; index++ {
		value := data[index]
		if index >= at+22 && index < at+26 {
			value = 0
		}
		crc ^= uint32(value) << 24
		for range 8 {
			if crc&0x80000000 != 0 {
				crc = crc<<1 ^ 0x04c11db7
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

// oggPage returns the end of a complete checksummed page at at, or -1.
func oggPage(data view, at int) int {
	if at+27 > len(data) || data.ascii(at, at+4) != "OggS" || data[at+4] != 0 {
		return -1
	}
	header := at + 27 + int(data[at+26])
	if header > len(data) {
		return -1
	}
	size := 0
	for index := at + 27; index < header; index++ {
		size += int(data[index])
	}
	end := header + size
	if end > len(data) || oggCRC(data, at, end) != binary.LittleEndian.Uint32(data[at+22:]) {
		return -1
	}
	return end
}

func validOgg(data view) bool {
	pages := 0
	for at := 0; at < len(data); pages++ {
		if at = oggPage(data, at); at < 0 {
			return false
		}
	}
	return pages > 0
}

var (
	kagLabel   = regexp.MustCompile(`(?:^|[\r\n])\*[^` + jsSpaceClass + `\[\]\r\n]+[^\r\n]*(?:\r?\n|$)`)
	kagCommand = regexp.MustCompile(`(?:^|[\r\n])(?:\[[A-Za-z_][^\]\r\n]*\]|@[A-Za-z_][^\r\n]*)`)
)

// jsSpaceClass is the JavaScript \s class body.
const jsSpaceClass = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

func validText(data []byte) bool {
	utf16 := len(data) >= 2 && data[0] == 0xff && data[1] == 0xfe
	if utf16 && len(data)%2 != 0 {
		return false
	}
	encodings := []string{"utf-8", "shift_jis"}
	if utf16 {
		encodings = []string{"utf-16le"}
	}
	for _, encoding := range encodings {
		value, ok := textcodec.Decode(data, encoding, false)
		if !ok || value == "" || hasControl(strings.NewReplacer("\t", "", "\r", "", "\n", "").Replace(value)) {
			continue
		}
		// A legacy decoder alone admits arbitrary filtered bytes; require a KAG label line and a command line.
		if encoding != "shift_jis" || kagLabel.MatchString(value) && kagCommand.MatchString(value) {
			return true
		}
	}
	return false
}

func hasControl(value string) bool {
	for _, character := range value {
		if unicode.Is(unicode.Cc, character) {
			return true
		}
	}
	return false
}

var fontSignature = []byte("TVP pre-rendered font\x1a")

type fontHeader struct {
	version             byte
	count, chars, index int
}

const maximumFontBytes = 32 * 1024 * 1024

// prerenderedHeader validates the TFT header and the zero padding between the character and index tables.
func prerenderedHeader(data view) *fontHeader {
	if len(data) < 36 || len(data) > maximumFontBytes || !bytes.Equal(data[:22], fontSignature) || data[23] != 2 ||
		data[22] > 1 {
		return nil
	}
	header := &fontHeader{version: data[22], count: int(data.u32(24)), chars: int(data.u32(28)), index: int(data.u32(32))}
	characterEnd := header.chars + header.count*2
	if header.count == 0 || header.count > 65536 || header.chars < 36 || header.index < characterEnd ||
		header.index-characterEnd > 4 || header.index+header.count*20 != len(data) ||
		bytes.Count(data[characterEnd:header.index], []byte{0}) != header.index-characterEnd {
		return nil
	}
	return header
}

// fontGlyphs maps each bitmap offset to its pixel count; characters ascend and shared bitmaps agree in size.
func fontGlyphs(data view, header *fontHeader) map[int]int {
	glyphs := map[int]int{}
	previous := -1
	for item := range header.count {
		character, record := data.u16(header.chars+item*2), header.index+item*20
		if character <= previous {
			return nil
		}
		previous = character
		offset, pixels := int(data.u32(record)), data.u16(record+4)*data.u16(record+6)
		if pixels == 0 {
			if offset != 0 && (offset < 36 || offset > header.chars) {
				return nil
			}
			continue
		}
		existing, known := glyphs[offset]
		if pixels > maximumFontBytes || offset < 36 || offset >= header.chars || known && existing != pixels {
			return nil
		}
		glyphs[offset] = pixels
	}
	return glyphs
}

// validPrerenderedFont validates the complete supported TFT representation, including every glyph.
func validPrerenderedFont(data view) bool {
	header := prerenderedHeader(data)
	if header == nil {
		return false
	}
	glyphs := fontGlyphs(data, header)
	return glyphs != nil && validGlyphs(data, glyphs, header.chars, header.version)
}

// glyphRun decodes one run code at at; it returns the next position and expanded count, or -1.
func glyphRun(data view, at, end, expanded int, version byte) (int, int) {
	value := data[at]
	at++
	switch {
	case version == 0 && value == 0x41:
		if expanded == 0 || at >= end {
			return -1, 0
		}
		return at + 1, expanded + int(data[at])
	case version == 1 && value >= 0x41:
		if expanded == 0 {
			return -1, 0
		}
		return at, expanded + int(value) - 0x40
	case value > 0x40:
		return -1, 0
	}
	return at, expanded + 1
}

// validGlyph decodes one encoded span exactly to pixels followed by at most four zero padding bytes.
func validGlyph(data view, at, end, pixels int, version byte) bool {
	for expanded := 0; expanded < pixels; {
		if at >= end {
			return false
		}
		if at, expanded = glyphRun(data, at, end, expanded, version); at < 0 || expanded > pixels {
			return false
		}
	}
	return end-at <= 4 && bytes.Count(data[at:end], []byte{0}) == end-at
}

func validGlyphs(data view, glyphs map[int]int, chars int, version byte) bool {
	offsets := make([]int, 0, len(glyphs))
	for offset := range glyphs {
		offsets = append(offsets, offset)
	}
	sortInts(offsets)
	if len(offsets) > 0 && offsets[0] != 36 || len(offsets) == 0 && chars != 36 {
		return false
	}
	// Each distinct encoded span is visited once, even when glyphs share a bitmap.
	for position, at := range offsets {
		end := chars
		if position+1 < len(offsets) {
			end = offsets[position+1]
		}
		if !validGlyph(data, at, end, glyphs[at], version) {
			return false
		}
	}
	return true
}

func sortInts(values []int) {
	for index := 1; index < len(values); index++ {
		for at := index; at > 0 && values[at] < values[at-1]; at-- {
			values[at], values[at-1] = values[at-1], values[at]
		}
	}
}

func recognized(data []byte) bool {
	return validPNG(data) || validOgg(data) || parsePE(data) != nil || validText(data) || validPrerenderedFont(data)
}

// representations admits only an unambiguous, complete supported representation under an authenticated filter.
func representations(raw []byte, filter *Filter, seed uint32) ([]byte, bool, bool) {
	require(len(raw) <= 32*1024*1024, "ARCHIVE_LIMIT")
	decoded := append([]byte(nil), raw...)
	filter.Apply(decoded, seed, 0, nil)
	plain, transformed := recognized(raw), recognized(decoded)
	require(plain || transformed, "CHECKSUM_MISMATCH")
	require(!plain || !transformed || bytes.Equal(raw, decoded), "FILTER_AMBIGUOUS")
	return decoded, plain, transformed
}

func resolveSeedOnly(raw []byte, filter *Filter, seed uint32) []byte {
	decoded, plain, _ := representations(raw, filter, seed)
	if plain {
		return raw
	}
	return decoded
}

// resolveFilteredSeed: protected native records are always filtered, even when their seed is not a checksum.
func resolveFilteredSeed(raw []byte, filter *Filter, seed uint32) []byte {
	decoded, _, transformed := representations(raw, filter, seed)
	require(transformed, "CHECKSUM_MISMATCH")
	return decoded
}
