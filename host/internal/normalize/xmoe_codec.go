package normalize

import (
	"bytes"
	"context"
	"encoding/binary"
	"regexp"
	"sort"
	"unicode/utf8"

	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

const (
	xmoeImage   = 32 * 1024 * 1024
	xmoeIndex   = 16 * 1024 * 1024
	xmoeFile    = 128 * 1024 * 1024
	xmoeTree    = 8 * 1024 * 1024 * 1024
	xmoeEntries = 100000
	xmoeNameMax = 4096
)

func requireXmoe(value bool, code ...string) {
	if !value {
		name := "RUNTIME_XMOE_INVALID"
		if len(code) > 0 {
			name = code[0]
		}
		panic(rules.Fail(name))
	}
}

func xmoeRange(data []byte, start, length int64) bytesView {
	requireXmoe(start >= 0 && length >= 0 && start <= int64(len(data)) && length <= int64(len(data))-start)
	return data[start : start+length]
}

var xmoeForbidden = regexp.MustCompile(`[/\\>:]`)

func xmoeName(data []byte) string {
	requireXmoe(len(data) > 0 && len(data) <= 2*xmoeNameMax && len(data)%2 == 0)
	name, ok := textcodec.Decode(data, "utf-16le", false)
	requireXmoe(ok)
	valid := name != "." && name != ".." && !xmoeForbidden.MatchString(name)
	for _, character := range name {
		valid = valid && character >= 32 && character != 127
	}
	requireXmoe(valid, "RUNTIME_XMOE_PATH_INVALID")
	return name
}

func xmoeNameHash(data []byte, seed uint32) uint64 {
	const m = 0x5bd1e995
	mix := func(value uint32) uint32 {
		value *= m
		return (value ^ value>>24) * m
	}
	h1, h2, at := seed^uint32(len(data)), uint32(0), 0
	for ; at+8 <= len(data); at += 8 {
		h1 = h1*m ^ mix(binary.LittleEndian.Uint32(data[at:]))
		h2 = h2*m ^ mix(binary.LittleEndian.Uint32(data[at+4:]))
	}
	if at+4 <= len(data) {
		h1 = h1*m ^ mix(binary.LittleEndian.Uint32(data[at:]))
		at += 4
	}
	if at < len(data) {
		tail := uint32(0)
		for index := 0; at+index < len(data); index++ {
			tail |= uint32(data[at+index]) << (index * 8)
		}
		h2 = (h2 ^ tail) * m
	}
	h1 = (h1 ^ h2>>18) * m
	h2 = (h2 ^ h1>>22) * m
	h1 = (h1 ^ h2>>17) * m
	h2 = (h2 ^ h1>>19) * m
	return uint64(h1)<<32 | uint64(h2)
}

type xmoeProfile struct {
	archiveName                 string
	packedXor, rawXor, countXor uint32
	versionXor                  uint32
	rotation                    int
	startMarker, endMarker      uint32
	hashSeed, payloadMagic      uint32
	key                         []byte
	evidence                    map[string]any
}

type xmoeHeader struct {
	count               int
	offset, packed, raw int64
}

func inspectXmoeHeader(header bytesView, profile *xmoeProfile, sourceSize int64) *xmoeHeader {
	requireXmoe(len(header) == 24 && sourceSize >= 24)
	version, count := header.u32(4)^profile.versionXor, header.u32(12)^profile.countXor
	offset, packed, raw := int64(header.u32(8)), int64(header.u32(16)^profile.packedXor),
		int64(header.u32(20)^profile.rawXor)
	requireXmoe(version == 1 && count > 0 && count <= xmoeEntries && offset >= 24 && offset <= sourceSize &&
		packed <= sourceSize-offset)
	requireXmoe(packed > 0 && packed <= xmoeIndex && raw > 0 && raw <= xmoeIndex, "RUNTIME_XMOE_LIMIT")
	return &xmoeHeader{count: int(count), offset: offset, packed: packed, raw: raw}
}

type xmoeEntry struct {
	name           string
	offset, packed int64
	logicalKey     string
}

func inspectXmoeArchive(ctx context.Context, header, indexPacked bytesView, profile *xmoeProfile,
	sourceSize int64,
) []*xmoeEntry {
	checkCancel(ctx)
	meta := inspectXmoeHeader(header, profile, sourceSize)
	requireXmoe(int64(len(indexPacked)) == meta.packed)
	index := unpackXmoeIndex(ctx, indexPacked, int(meta.raw))
	var entries []*xmoeEntry
	seen := map[string]bool{}
	at, total := int64(0), int64(0)
	for at < int64(len(index)) {
		checkCancel(ctx)
		row := xmoeRange(index, at, 24)
		nameLength := int64(row.u32(20))
		requireXmoe(nameLength > 0 && nameLength <= xmoeNameMax)
		encoded := xmoeRange(index, at+24, nameLength*2)
		requireXmoe(xmoeRange(index, at+24+int64(len(encoded)), 2).u16(0) == 0)
		name := xmoeName(encoded)
		requireXmoe(xmoeNameHash(encoded, profile.hashSeed) == binary.LittleEndian.Uint64(row[4:]) && !seen[name])
		seen[name] = true
		offset, packed := int64(row.u32(12)), int64(row.u32(16))
		total += packed
		requireXmoe(offset >= 24 && packed >= 8 && packed <= xmoeFile && offset <= meta.offset &&
			packed <= meta.offset-offset)
		requireXmoe(total <= xmoeTree, "RUNTIME_XMOE_LIMIT")
		entries = append(entries, &xmoeEntry{name: name, offset: offset, packed: packed})
		at += 26 + int64(len(encoded))
	}
	requireXmoe(len(entries) == meta.count)
	sorted := append([]*xmoeEntry(nil), entries...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].offset < sorted[j].offset })
	for index := 1; index < len(sorted); index++ {
		requireXmoe(sorted[index-1].offset+sorted[index-1].packed <= sorted[index].offset)
	}
	return entries
}

func checkCancel(ctx context.Context) {
	if ctx.Err() != nil {
		panic(rules.Fail("RUNTIME_CANCELLED"))
	}
}

func decodeXmoePayload(ctx context.Context, payload []byte, profile *xmoeProfile) []byte {
	checkCancel(ctx)
	requireXmoe(len(payload) >= 9 && len(payload) <= xmoeFile)
	size := len(profile.key)
	requireXmoe(size > 0 && size <= 65536 && size&(size-1) == 0 && profile.rotation >= 1 && profile.rotation <= 7)
	decoded := make(bytesView, len(payload))
	mask := size - 1
	for index := range payload {
		if index&65535 == 0 {
			checkCancel(ctx)
		}
		decoded[index] = payload[index] ^ profile.key[index&mask]
	}
	requireXmoe(decoded.u32(0) == profile.payloadMagic)
	raw := unpackXmoeLZ4(ctx, decoded[8:], int(decoded.u32(4)))
	return normalizeXmoePSB(ctx, raw, profile)
}

type huffmanNode struct {
	children [2]*huffmanNode
	symbol   int
}

type bitReader struct {
	data []byte
	bit  int
}

func (r *bitReader) read(count int) int {
	requireXmoe(count >= 0 && count <= 16 && r.bit+count <= len(r.data)*8)
	value := 0
	for index := range count {
		value |= int(r.data[r.bit>>3]>>(r.bit&7)&1) << index
		r.bit++
	}
	return value
}

func (n *huffmanNode) add(symbol, length, code int) {
	requireXmoe(length > 0 && length <= 9)
	node := n
	for index := range length {
		requireXmoe(node.symbol < 0)
		key := code >> index & 1
		if node.children[key] == nil {
			node.children[key] = &huffmanNode{symbol: -1}
		}
		node = node.children[key]
	}
	requireXmoe(node.symbol < 0 && node.children[0] == nil && node.children[1] == nil)
	node.symbol = symbol
}

// unpackXmoeIndex decodes an LSB-first CHuffman table and escape runs, followed by a u32 output length.
func unpackXmoeIndex(ctx context.Context, data []byte, expected int) []byte {
	checkCancel(ctx)
	reader := &bitReader{data: data}
	count, escape := reader.read(8), reader.read(8)
	root := &huffmanNode{symbol: -1}
	root.add(256, escape, reader.read(escape))
	symbols := map[int]bool{256: true}
	for range count {
		symbol, length := reader.read(8), reader.read(8)
		requireXmoe(!symbols[symbol])
		symbols[symbol] = true
		root.add(symbol, length, reader.read(length))
	}
	tableBytes := reader.bit>>3 + 1
	length := int(xmoeRange(data, int64(tableBytes), 4).u32(0))
	requireXmoe(length > 0 && length <= xmoeIndex, "RUNTIME_XMOE_LIMIT")
	requireXmoe(length == expected)
	reader.bit = (tableBytes + 4) * 8
	result := make([]byte, length)
	for at := 0; at < length; {
		if at&4095 == 0 {
			checkCancel(ctx)
		}
		node := root
		for node.symbol < 0 {
			node = node.children[reader.read(1)]
			requireXmoe(node != nil)
		}
		if node.symbol != 256 {
			result[at] = byte(node.symbol)
			at++
			continue
		}
		run := reader.read(4)
		requireXmoe(run > 0 && run <= length-at)
		for range run {
			result[at] = byte(reader.read(8))
			at++
		}
	}
	requireXmoe(len(data)*8-reader.bit < 8)
	for reader.bit < len(data)*8 {
		requireXmoe(reader.read(1) == 0)
	}
	return result
}

func unpackXmoeLZ4(ctx context.Context, data []byte, length int) []byte {
	checkCancel(ctx)
	requireXmoe(length > 0 && length <= xmoeFile, "RUNTIME_XMOE_LIMIT")
	result := make([]byte, length)
	at, out := 0, 0
	extension := func(size int) int {
		if size != 15 {
			return size
		}
		for {
			requireXmoe(at < len(data))
			next := int(data[at])
			at++
			size += next
			requireXmoe(size <= length)
			if next != 255 {
				return size
			}
		}
	}
	for out < length {
		checkCancel(ctx)
		requireXmoe(at < len(data))
		token := int(data[at])
		at++
		literals := extension(token >> 4)
		requireXmoe(literals <= length-out)
		copy(result[out:], xmoeRange(data, int64(at), int64(literals)))
		at += literals
		out += literals
		if out == length {
			break
		}
		back := xmoeRange(data, int64(at), 2).u16(0)
		at += 2
		count := extension(token&15) + 4
		requireXmoe(back > 0 && back <= out && count <= length-out)
		for index := range count {
			if index&4095 == 0 {
				checkCancel(ctx)
			}
			result[out] = result[out-back]
			out++
		}
	}
	requireXmoe(at == len(data))
	return result
}

type stringVector struct{ at, count, width int }

func readUintLE(data []byte, width int) uint64 {
	value := uint64(0)
	for index := range width {
		value |= uint64(data[index]) << (8 * index)
	}
	return value
}

func stringTable(data []byte, start, stop int) stringVector {
	at := start
	countBytes := int(xmoeRange(data, int64(at), 1)[0]) - 12
	at++
	requireXmoe(countBytes >= 1 && countBytes <= 4)
	count := int(readUintLE(xmoeRange(data, int64(at), int64(countBytes)), countBytes))
	at += countBytes
	width := int(xmoeRange(data, int64(at), 1)[0]) - 12
	at++
	requireXmoe(width >= 1 && width <= 4 && count <= xmoeEntries)
	requireXmoe(at+count*width <= stop)
	return stringVector{at: at, count: count, width: width}
}

func markerBytes(value uint32) []byte {
	result := make([]byte, 4)
	binary.LittleEndian.PutUint32(result, value)
	return result
}

func xmoeText(data []byte, profile *xmoeProfile) []byte {
	start, end := markerBytes(profile.startMarker), markerBytes(profile.endMarker)
	var result []byte
	at := 0
	for {
		first := indexFrom(data, start, at)
		if first < 0 {
			result = append(result, data[at:]...)
			break
		}
		last := indexFrom(data, end, first+4)
		requireXmoe(last >= 0)
		result = append(result, data[at:first]...)
		for _, value := range data[first+4 : last] {
			result = append(result, value>>profile.rotation|value<<(8-profile.rotation))
		}
		at = last + 4
	}
	requireXmoe(utf8.Valid(result))
	return result
}

func indexFrom(data, pattern []byte, from int) int {
	if from > len(data) {
		return -1
	}
	found := bytes.Index(data[from:], pattern)
	if found < 0 {
		return -1
	}
	return from + found
}

var psbSignature = []byte{0x50, 0x53, 0x42, 0, 2, 0, 0, 0}

// decodePSBStrings rewrites the string pool as plain text and returns the matching offset table.
func decodePSBStrings(ctx context.Context, data bytesView, profile *xmoeProfile, table, body, chunks int,
) ([]byte, []byte) {
	vector := stringTable(data, table, body)
	offsets := append([]byte(nil), data[table:body]...)
	var strings []byte
	size := 0
	for index := range vector.count {
		checkCancel(ctx)
		position := vector.at + index*vector.width
		offset := int(readUintLE(xmoeRange(data, int64(position), int64(vector.width)), vector.width))
		requireXmoe(offset < chunks-body)
		end := indexFrom(data, []byte{0}, body+offset)
		requireXmoe(end >= body+offset && end < chunks)
		value := xmoeText(data[body+offset:end], profile)
		requireXmoe(uint64(size) < uint64(1)<<(vector.width*8))
		for byteIndex := range vector.width {
			offsets[position-table+byteIndex] = byte(size >> (8 * byteIndex))
		}
		strings = append(append(strings, value...), 0)
		size += len(value) + 1
		requireXmoe(size <= xmoeFile, "RUNTIME_XMOE_LIMIT")
	}
	return offsets, strings
}

// normalizeXmoePSB rebuilds only the PSB v2 strings and their relative-offset vector.
func normalizeXmoePSB(ctx context.Context, data bytesView, profile *xmoeProfile) []byte {
	checkCancel(ctx)
	requireXmoe(len(data) >= 40 && bytes.Equal(data[:8], psbSignature))
	encrypt, names, table, body := data.u32(8), data.u32(12), data.u32(16), data.u32(20)
	chunks, lengths, chunkData, entries := data.u32(24), data.u32(28), data.u32(32), data.u32(36)
	requireXmoe(encrypt < table && names >= 40 && names <= entries && entries < table && table < body && body <= chunks &&
		chunks <= lengths && lengths <= chunkData && int(chunkData) <= len(data))
	offsets, strings := decodePSBStrings(ctx, data, profile, int(table), int(body), int(chunks))
	size := len(strings)
	delta := int64(size) - int64(chunks-body)
	output := append(append(append([]byte(nil), data[:table]...), offsets...), strings...)
	output = append(output, data[chunks:]...)
	requireXmoe(len(output) <= xmoeFile, "RUNTIME_XMOE_LIMIT")
	for _, field := range []int{24, 28, 32} {
		shifted := int64(data.u32(field)) + delta
		if shifted < 0 || shifted > 0xffffffff {
			panic(errRange)
		}
		binary.LittleEndian.PutUint32(output[field:], uint32(shifted))
	}
	return output
}
