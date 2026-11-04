package normalize

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/binary"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
)

type enigmaSection struct {
	raw, length, rva, virtual int
	flags                     uint32
}

type enigmaLayout struct {
	sections []enigmaSection
	entry    int
}

// owner resolves an RVA by the last owning virtual section; a reserved loader section can be larger on disk.
func (l *enigmaLayout) owner(rva int) *enigmaSection {
	for index := len(l.sections) - 1; index >= 0; index-- {
		item := &l.sections[index]
		if rva >= item.rva && rva < item.rva+item.virtual {
			return item
		}
	}
	return nil
}

func (l *enigmaLayout) fromRVA(rva, length int) int {
	item := l.owner(rva)
	if item != nil && length <= item.length-(rva-item.rva) {
		return item.raw + rva - item.rva
	}
	return -1
}

// enigmaHeaders32 reads the PE32 optional header and section table, or returns nil.
func enigmaHeaders32(ctx context.Context, handle *content.Handle, size, nt int64) (bytesView, int64, int64) {
	head := readEnigma(ctx, handle, size, nt, 24)
	count, optional := int64(head.u16(6)), int64(head.u16(20))
	if head.u32(0) != 0x4550 || head.u16(4) != 0x14c || count == 0 || count > 96 || optional < 96 || optional > 4096 ||
		nt+24+optional+count*40 > size {
		return nil, 0, 0
	}
	rest := readEnigma(ctx, handle, size, nt+24, optional+count*40)
	if rest.u16(0) != 0x10b {
		return nil, 0, 0
	}
	return rest, optional, count
}

func readEnigmaLayout(ctx context.Context, handle *content.Handle, size int64) *enigmaLayout {
	if size < 64 {
		return nil
	}
	dos := readEnigma(ctx, handle, size, 0, 64)
	nt := int64(dos.u32(60))
	if string(dos[:2]) != "MZ" || nt < 64 || nt > min(size-24, 1024*1024) {
		return nil
	}
	rest, optional, count := enigmaHeaders32(ctx, handle, size, nt)
	if rest == nil {
		return nil
	}
	layout := &enigmaLayout{entry: int(rest.u32(16))}
	for index := range int(count) {
		at := int(optional) + 40*index
		raw, length := int64(rest.u32(at+20)), int64(rest.u32(at+16))
		if raw > size || length > size-raw {
			return nil
		}
		layout.sections = append(layout.sections, enigmaSection{
			raw: int(raw), length: int(length), rva: int(rest.u32(at + 12)),
			virtual: int(rest.u32(at + 8)), flags: rest.u32(at + 36),
		})
	}
	return layout
}

var (
	bootstrapPrefix = []int{0x60, 0xe8, 0, 0, 0, 0, 0x5d, 0x81, 0xed, 16, 0, 0, 0, 0x81, 0xed}
	xorStage        = []int{
		0xb8, wild, wild, wild, wild, 3, 0xc5, 0x81, 0xc0,
		wild, wild, wild, wild, 0xb9, wild, wild, wild, wild, 0xba, wild, wild, wild, wild, 0x30, 0x10, 0x40, 0x49,
		0x0f, 0x85, 0xf6, 255, 255, 255,
	}
	handoffPattern = []int{
		0x54, 0x64, 0xff, 0x35, 0, 0, 0, 0, 0x68, wild, wild, wild, wild,
		0x55, 0x56, 0x8b, 0x46, 0x3c, 0x8b, 0x84, 0x30, 0x28, 0, 0, 0, 3, 0xc6, 0xff, 0xe0,
	}
	loaderPattern = []int{
		0x8b, 0xcd, 0x8b, 0x89, 0x3c, 0, 0, 0, 0x81, 0xc1, 0xf8, 0, 0, 0, 3, 0xcd,
		0xb8, wild, wild, wild, wild, 0xba, 0x28, 0, 0, 0, 0xf7, 0xe2, 3, 0xc8, 0x8b, 0x81, 12, 0, 0, 0, 3, 0xc5,
	}
)

type bootstrapResult struct {
	configRVA, loaderSection, xorStages int
	decoded                             bytesView
}

// xorStages applies every newly exposed XOR stage once; it reports whether any stage was applied.
func xorStages(decoded bytesView, entry int, visited map[int]bool) bool {
	changed := false
	for at := 29; at+33 <= len(decoded); at++ {
		if visited[at] || !matchAt(decoded, at, xorStage) || int(decoded.u32(at+1)) != entry {
			continue
		}
		start, size, key := int(decoded.u32(at+9)), int(decoded.u32(at+14)), decoded[at+19]
		requireEnigma(len(visited) < 8 && start >= at+33 && size > 0 && size <= len(decoded)-start, "UNSUPPORTED")
		for index := start; index < start+size; index++ {
			decoded[index] ^= key
		}
		visited[at] = true
		changed = true
	}
	return changed
}

func decodeBootstrap(data bytesView, entry int) *bootstrapResult {
	if !matchAt(data, 10, bootstrapPrefix) || int(data.u32(25)) != entry {
		return nil
	}
	decoded := bytesView(append([]byte(nil), data...))
	visited := map[int]bool{}
	for changed := true; changed; {
		changed = xorStages(decoded, entry, visited)
	}
	requireEnigma(len(visited) > 0, "UNSUPPORTED")
	var handoffs, loaders []int
	for at := range decoded {
		if matchAt(decoded, at, handoffPattern) {
			handoffs = append(handoffs, int(decoded.u32(at+9)))
		}
		if matchAt(decoded, at, loaderPattern) {
			loaders = append(loaders, int(decoded.u32(at+17)))
		}
	}
	requireEnigma(len(handoffs) == 1 && len(loaders) == 1, "UNSUPPORTED")
	return &bootstrapResult{configRVA: handoffs[0], loaderSection: loaders[0], xorStages: len(visited), decoded: decoded}
}

type enigmaSettings struct {
	headerState, payloadState  []byte
	compressed                 bool
	packageOffset, packageSize int64
}

func readSettings(config bytesView) *enigmaSettings {
	at := int64(16)
	word := func() int64 {
		value := enigmaRange(config, at, 4).u32(0)
		at += 4
		return int64(value)
	}
	skip := func(size int64) {
		enigmaRange(config, at, size)
		at += size
	}
	restore := word()
	word()
	skip(restore)
	for _, width := range []int64{80, 20} {
		count := word()
		requireEnigma(count <= enigmaEntries, "LIMIT")
		skip(count * width)
	}
	entries := word()
	requireEnigma(entries > 0 && entries <= 96, "UNSUPPORTED")
	skip((entries-1)*8 + 8)
	skip(0xdc + 0x88)
	fields := enigmaRange(config, at, 0xf5d0)
	field := func(offset int) int { return offset - 0x328 }
	requireEnigma(int64(len(config)) == at+int64(len(fields)), "UNSUPPORTED")
	requireEnigma(fields[field(0xb078)] == 1 && fields[field(0xb07a)] <= 1, "UNSUPPORTED")
	state := field(0xb081)
	return &enigmaSettings{
		headerState:  append([]byte(nil), fields[state:state+256]...),
		payloadState: append([]byte(nil), fields[state+256:state+512]...), compressed: fields[field(0xb07a)] != 0,
		packageOffset: int64(fields.u32(field(0xb488))), packageSize: int64(fields.u32(field(0xb484))),
	}
}

type protectedConfiguration struct {
	bootstrap         bytesView
	entryRVA          int
	layout            *enigmaLayout
	masterConfig      bytesView
	loaderVirtualSize int
}

type enigmaProfile struct {
	*enigmaSettings
	base          int64
	configuration *protectedConfiguration
	evidence      map[string]any
}

func md5Bytes(data []byte) []byte {
	sum := md5.Sum(data)
	return sum[:]
}

// enigmaPE recognizes the connected self-decoder/configuration vocabulary; no x86 is executed.
func enigmaPE(ctx context.Context, handle *content.Handle, size int64) *enigmaProfile {
	layout := readEnigmaLayout(ctx, handle, size)
	if layout == nil {
		return nil
	}
	entryAt := layout.fromRVA(layout.entry, 80)
	if entryAt < 0 {
		return nil
	}
	owner := layout.owner(layout.entry)
	data := readEnigma(ctx, handle, size, int64(entryAt), int64(min(enigmaBootstrap, owner.raw+owner.length-entryAt)))
	bootstrap := decodeBootstrap(data, layout.entry)
	if bootstrap == nil {
		return nil
	}
	configAt := layout.fromRVA(bootstrap.configRVA, 28)
	requireEnigma(configAt >= 0 && bootstrap.loaderSection < len(layout.sections), "UNSUPPORTED")
	header := readEnigma(ctx, handle, size, int64(configAt), 28)
	count, packed, expanded := int(header.u32(0)), int(header.u32(4)), int(header.u32(8))
	requireEnigma(count > 0 && count <= len(layout.sections) && packed > 0 && packed <= enigmaMetadata &&
		expanded <= enigmaMetadata, "LIMIT")
	requireEnigma(layout.fromRVA(bootstrap.configRVA+28, packed) == configAt+28)
	source := readEnigma(ctx, handle, size, int64(configAt+28), int64(packed))
	requireEnigma(bytes.Equal(md5Bytes(source), header[12:28]))
	key := make([]byte, 16)
	hashed := 0
	for _, item := range layout.sections[:count] {
		if item.flags&0x10000000 != 0 {
			continue
		}
		hashed += item.length
		requireEnigma(hashed <= 64*1024*1024, "LIMIT")
		sum := md5Bytes(readEnigma(ctx, handle, size, int64(item.raw), int64(item.length)))
		for index := range 16 {
			key[index] ^= sum[index]
		}
	}
	config := enigmaDepack(ctx, enigmaCrypt(source, enigmaSchedule(key)), expanded, false)
	requireEnigma(len(config) >= 16 && bytes.Equal(md5Bytes(config[16:]), config[:16]))
	settings := readSettings(config)
	base := int64(layout.sections[bootstrap.loaderSection].raw) + settings.packageOffset
	requireEnigma(settings.packageSize >= 120 && settings.packageSize <= size-base)
	return &enigmaProfile{
		enigmaSettings: settings, base: base,
		configuration: &protectedConfiguration{
			bootstrap: bootstrap.decoded, entryRVA: layout.entry, layout: layout,
			masterConfig: config, loaderVirtualSize: layout.sections[bootstrap.loaderSection].virtual,
		},
		evidence: map[string]any{
			"entryRva": layout.entry, "configRva": bootstrap.configRVA, "xorStages": bootstrap.xorStages,
			"hashedSections": count, "configurationBytes": len(config),
		},
	}
}

func u16be(data []byte, at int) uint16 { return binary.BigEndian.Uint16(data[at:]) }
