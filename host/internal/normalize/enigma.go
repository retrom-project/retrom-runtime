package normalize

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

func ideaMultiply(a, b uint32) uint32 {
	if a == 0 {
		a = 65536
	}
	if b == 0 {
		b = 65536
	}
	return uint32(uint64(a)*uint64(b)%65537) & 65535
}

func ideaInverse(value uint16) uint16 {
	a, b, x, y := int64(value), int64(65537), int64(1), int64(0)
	if a == 0 {
		a = 65536
	}
	for b != 0 {
		q := a / b
		a, b = b, a-q*b
		x, y = y, x-q*y
	}
	return uint16((x%65537 + 65537) % 65537 & 65535)
}

type ideaSchedule struct{ encode, decode [52]uint16 }

func ideaKeys(key []byte) *ideaSchedule {
	result := &ideaSchedule{}
	for index := range 8 {
		result.encode[index] = u16be(key, 2*index)
	}
	for index := 8; index < 52; index++ {
		n := index & 7
		first, second := 7, 6
		if n == 7 {
			first = 15
		}
		if n >= 6 {
			second = 14
		}
		result.encode[index] = result.encode[index-first]<<9 | result.encode[index-second]>>7
	}
	for round := range 9 {
		at, source := 6*round, 48-6*round
		result.decode[at] = ideaInverse(result.encode[source])
		result.decode[at+3] = ideaInverse(result.encode[source+3])
		one, two := 2, 1
		if round == 0 || round == 8 {
			one, two = 1, 2
		}
		result.decode[at+1] = -result.encode[source+one]
		result.decode[at+2] = -result.encode[source+two]
		if round < 8 {
			result.decode[at+4], result.decode[at+5] = result.encode[source-2], result.encode[source-1]
		}
	}
	return result
}

func ideaBlock(data []byte, keys *[52]uint16) []byte {
	x1, x2, x3, x4 := uint32(u16be(data, 0)), uint32(u16be(data, 2)), uint32(u16be(data, 4)), uint32(u16be(data, 6))
	for index := 0; index < 48; index += 6 {
		x1 = ideaMultiply(x1, uint32(keys[index]))
		x2 = (x2 + uint32(keys[index+1])) & 65535
		x3 = (x3 + uint32(keys[index+2])) & 65535
		x4 = ideaMultiply(x4, uint32(keys[index+3]))
		a := ideaMultiply(x1^x3, uint32(keys[index+4]))
		b := ideaMultiply((x2^x4+a)&65535, uint32(keys[index+5]))
		a = (a + b) & 65535
		x1, x2, x3, x4 = x1^b, x3^b, x2^a, x4^a
	}
	out := make([]byte, 8)
	binary.BigEndian.PutUint16(out, uint16(ideaMultiply(x1, uint32(keys[48]))))
	binary.BigEndian.PutUint16(out[2:], uint16((x3+uint32(keys[49]))&65535))
	binary.BigEndian.PutUint16(out[4:], uint16((x2+uint32(keys[50]))&65535))
	binary.BigEndian.PutUint16(out[6:], uint16(ideaMultiply(x4, uint32(keys[51]))))
	return out
}

// enigmaIdeaDecrypt is native IDEA-128 CBC with E_K(0) as IV and an encrypted previous block for a partial tail.
func enigmaIdeaDecrypt(ctx context.Context, data, key []byte) []byte {
	if ctx.Err() != nil {
		panic(rules.Fail("RUNTIME_CANCELLED"))
	}
	requireEnigma(len(key) == 16 && len(data) <= enigmaMetadata)
	keys := ideaKeys(key)
	out := make([]byte, len(data))
	previous := ideaBlock(make([]byte, 8), &keys.encode)
	at := 0
	for ; at+8 <= len(data); at += 8 {
		if at&4095 == 0 && ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		plain := ideaBlock(data[at:at+8], &keys.decode)
		for index := range 8 {
			out[at+index] = plain[index] ^ previous[index]
		}
		previous = data[at : at+8]
	}
	if at < len(data) {
		tail := ideaBlock(previous, &keys.encode)
		for index := 0; at+index < len(data); index++ {
			out[at+index] = data[at+index] ^ tail[index]
		}
	}
	return out
}

type maskReader struct {
	ctx        context.Context
	data       bytesView
	at         int64
	operations int64
}

func (r *maskReader) take(n int64) bytesView {
	value := enigmaRange(r.data, r.at, n)
	r.at += n
	return value
}

func (r *maskReader) word() int64 { return int64(r.take(4).u32(0)) }

func (r *maskReader) each(action func()) {
	n := r.word()
	r.operations += n
	requireEnigma(n <= enigmaEntries && r.operations <= enigmaEntries, "LIMIT")
	for ; n > 0; n-- {
		if r.ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		action()
	}
}

func (r *maskReader) wide() bytesView {
	n := r.word()
	requireEnigma(n <= enigmaMetadata/2, "LIMIT")
	return r.take(n * 2)
}

func (r *maskReader) variant() { r.take(int64(r.take(2).u16(0))) }

// enigmaExternalMasks parses the native dynamic configuration grammar, retaining only mount masks.
func enigmaExternalMasks(ctx context.Context, data bytesView) []string {
	requireEnigma(len(data) <= enigmaMetadata, "LIMIT")
	r := &maskReader{ctx: ctx, data: data}
	r.each(func() {
		n := r.take(1)[0]
		r.take(8)
		r.take(int64(n))
	})
	for range 3 {
		r.variant()
	}
	r.take(int64(r.take(1)[0])) // serialized locale string, replaced by a native locale at execution
	for range 6 {
		r.variant()
	}
	for _, width := range []int64{4, 16, 16} {
		r.each(func() { r.take(width) })
	}
	r.each(func() {
		r.take(2)
		r.wide()
		r.take(1)
		r.wide()
		r.take(1)
		r.wide()
	})
	r.each(func() { r.take(256) })
	r.each(func() {
		r.take(1)
		r.wide()
		r.wide()
	})
	r.each(func() { r.take(512) })
	r.each(func() { r.take(544) })
	r.each(func() {
		r.take(20)
		r.take(r.word())
	})
	var masks []string
	r.each(func() {
		value, ok := textcodec.Decode(r.wide(), "utf-16le", true)
		requireEnigma(ok)
		requireEnigma(value != "" && !hasControlBelow32(value), "UNSUPPORTED")
		masks = append(masks, value)
	})
	requireEnigma(r.at == int64(len(data)), "UNSUPPORTED")
	return masks
}

func hasControlBelow32(value string) bool {
	for _, character := range value {
		if character < 32 {
			return true
		}
	}
	return false
}

var (
	loaderHead = []int{
		0x50, 0x50, 0x68, wild, wild, wild, wild, 0x68, wild, wild, wild, wild,
		1, 0x2c, 0x24, 0x68, wild, wild, wild, wild, 0xe8, 5, 0, 0, 0, 0xe9, 0x28, 0, 0, 0,
	}
	loaderBody = []int{
		0x55, 0x8b, 0xec, 0x8b, 0x85, 8, 0, 0, 0, 0x8b, 0x95, 12, 0, 0, 0,
		0x8b, 0x8d, 16, 0, 0, 0, 0xc1, 0xe9, 2, 0x31, 2, 0x83, 0xc2, 4, 0x49, 0x0f, 0x85, 0xf4, 255, 255, 255, 0x5d,
		0xc2, 12, 0,
	}
	loaderTail = []int{
		0x8b, 0x8c, 0x24, 4, 0, 0, 0, 0x68, wild, wild, wild, wild,
		0x68, wild, wild, wild, wild, 1, 0x2c, 0x24, 0x51, 0xe8, 5, 0, 0, 0, 0xe9,
	}
	bcjCall = mustHex("294c390183c10583e804")
	bcjJump = mustHex("2954390283c10683ea0483e805")
)

func mustHex(value string) []byte {
	decoded, err := hex.DecodeString(value)
	if err != nil {
		panic(err)
	}
	return decoded
}

type externalLoader struct {
	length, rva int
	key         uint32
}

func enigmaLoaderParameters(bootstrap bytesView) externalLoader {
	var found []externalLoader
	for at := 0; at+108 < len(bootstrap); at++ {
		if !matchAt(bootstrap, at, loaderHead) || !matchAt(bootstrap, at+30, loaderBody) || !matchAt(bootstrap,
			at+70, loaderTail) {
			continue
		}
		length, rva := int(bootstrap.u32(at+3)), int(bootstrap.u32(at+8))
		requireEnigma(length == int(bootstrap.u32(at+78)) && rva == int(bootstrap.u32(at+83)), "UNSUPPORTED")
		found = append(found, externalLoader{length: length, rva: rva, key: bootstrap.u32(at + 16)})
	}
	requireEnigma(len(found) == 1, "UNSUPPORTED")
	// These connected BCJ write instructions establish the post-depack transform.
	requireEnigma(bytes.Contains(bootstrap, bcjCall) && bytes.Contains(bootstrap, bcjJump), "UNSUPPORTED")
	return found[0]
}

func unfilterLoader(data bytesView) bytesView {
	delta := uint32(0)
	for at := 0; at+6 <= len(data); {
		switch {
		case data[at] == 0xe8 || data[at] == 0xe9:
			binary.LittleEndian.PutUint32(data[at+1:], data.u32(at+1)-uint32(at))
			at += 5
		case data[at] == 255 && data[at+1] == 0x25:
			binary.LittleEndian.PutUint32(data[at+2:], data.u32(at+2)-delta)
			at += 6
			delta -= 4
		default:
			at++
		}
	}
	return data
}

type externalConfig struct {
	masks                     []string
	headerState, payloadState []byte
	encryptedHeader           bool
	evidence                  map[string]any
}

// enigmaExternalConfig recovers explicitly configured external mounts using the same static loader.
func enigmaExternalConfig(ctx context.Context, handle *content.Handle, size int64,
	configuration *protectedConfiguration,
) *externalConfig {
	master := configuration.masterConfig
	const fixed = 0xdc + 0x88 + 0xf5d0
	requireEnigma(len(master) >= fixed)
	fields := master[len(master)-0xf5d0:]
	secondary := master[len(master)-0xf5d0-0x88 : len(master)-0xf5d0]
	field := func(n int) int { return n - 0x328 }
	packed, expanded := int(secondary.u32(0x310-0x2a0)), int(secondary.u32(0x314-0x2a0))
	state := fields[field(0xb081)+512 : field(0xb081)+1024]
	result := &externalConfig{
		headerState: append([]byte(nil), state[:256]...), payloadState: append([]byte(nil), state[256:]...),
		encryptedHeader: fields[field(0xb07d)] != 0,
	}
	if packed == 0 && expanded == 0 {
		return result
	}
	requireEnigma(packed > 0 && packed <= enigmaMetadata && expanded > 0 && expanded <= enigmaMetadata, "LIMIT")
	loader := enigmaLoaderParameters(configuration.bootstrap)
	sourceAt := configuration.layout.fromRVA(loader.rva, loader.length)
	requireEnigma(sourceAt >= 0 && loader.length > 0 && loader.length <= enigmaMetadata, "UNSUPPORTED")
	source := readEnigma(ctx, handle, size, int64(sourceAt), int64(loader.length))
	for at := 0; at+4 <= len(source); at += 4 {
		binary.LittleEndian.PutUint32(source[at:], source.u32(at)^loader.key)
	}
	image := unfilterLoader(enigmaDepack(ctx, source, configuration.loaderVirtualSize, true))
	requireEnigma(string(image[:2]) == "MZ", "UNSUPPORTED")
	nt := int64(enigmaRange(image, 60, 4).u32(0))
	requireEnigma(enigmaRange(image, nt, 4).u32(0) == 0x4550 &&
		int(enigmaRange(image, nt+80, 4).u32(0)) == configuration.loaderVirtualSize, "UNSUPPORTED")
	dynamicRVA := int64(secondary.u32(0x30c - 0x2a0))
	decrypted := enigmaIdeaDecrypt(ctx, enigmaRange(image, dynamicRVA, int64(packed)), enigmaRange(fields,
		int64(field(0x5b8)), 16))
	dynamic := enigmaDepack(ctx, decrypted, expanded, false)
	result.masks = enigmaExternalMasks(ctx, dynamic)
	result.evidence = map[string]any{
		"loaderRva": loader.rva, "loaderBytes": len(image), "dynamicRva": dynamicRVA,
		"configurationBytes": len(dynamic),
	}
	return result
}

func cstring(data bytesView, start int) (string, int) {
	at := start
	for at+2 <= len(data) && data.u16(at) != 0 {
		at += 2
		requireEnigma(at-start <= 8192, "LIMIT")
	}
	requireEnigma(at+2 <= len(data))
	text, ok := textcodec.Decode(data[start:at], "utf-16le", true)
	requireEnigma(ok)
	return text, at + 2
}

type enigmaRow struct {
	name              string
	sizeBytes, stored int64
	offset            int64
	payloadState      []byte
	compressed        bool
	sourceKey         string
	logicalKey        string
}

func enigmaFileRecord(data bytesView, at int) (int64, int64) {
	enigmaRange(data, int64(at), 38)
	registration, action, size := data[at], data[at+1], enigmaNumber(data, int64(at+2))
	flags := data.at(at + 38)
	target, end := cstring(data, at+39)
	stored := enigmaNumber(data, int64(end))
	requireEnigma(registration == 0 && action == 0 && flags == 0 && target == "", "UNSUPPORTED")
	requireEnigma(size <= enigmaFile && stored <= enigmaFile, "LIMIT")
	requireEnigma(end+8 == len(data))
	return size, stored
}

type vfsProfile struct {
	base, packageSize         int64
	headerState, payloadState []byte
	compressed                bool
	encryptedHeader           *bool
}

type vfsResult struct {
	rows          []*enigmaRow
	timestamp     float64
	metadataBytes int64
}

type vfsFrame struct {
	count int
	path  string
	root  bool
}

var enigmaForbidden = regexp.MustCompile(`[\\/%]`)

// enigmaHeaders validates both package headers and returns the package timestamp.
func enigmaHeaders(ctx context.Context, handle *content.Handle, sourceSize int64, profile *vfsProfile) float64 {
	base, packageSize := profile.base, profile.packageSize
	first := readEnigma(ctx, handle, sourceSize, base, 56)
	if profile.encryptedHeader == nil || *profile.encryptedHeader {
		first = enigmaCrypt(first, profile.headerState)
	}
	// Header 1 begins with a counted signature, not a format version.
	requireEnigma(first.u32(0) > 0 && first.u32(0) <= 44, "UNSUPPORTED")
	requireEnigma(enigmaNumber(first, 48)+56 == packageSize)
	header := enigmaCrypt(readEnigma(ctx, handle, sourceSize, base+56, 64), profile.headerState)
	requireEnigma(header.u32(0) == 0 && header.u32(4) == 64 && enigmaNumber(header, 24) == 120 &&
		enigmaNumber(header, 32)+120 == packageSize && enigmaNumber(header, 48) == packageSize)
	timestamp := math.Float64frombits(binary.LittleEndian.Uint64(header[8:]))
	requireEnigma(!math.IsNaN(timestamp) && !math.IsInf(timestamp, 0), "UNSUPPORTED")
	return timestamp
}

type vfsWalker struct {
	ctx       context.Context
	handle    *content.Handle
	profile   *vfsProfile
	result    *vfsResult
	seen      map[string]bool
	at, limit int64
	total     int64
}

// record reads one length-prefixed encrypted directory record.
func (w *vfsWalker) record() bytesView {
	length := int64(enigmaCrypt(readEnigma(w.ctx, w.handle, w.limit, w.at, 4), w.profile.headerState).u32(0))
	w.at += 4
	w.result.metadataBytes += 4 + length
	requireEnigma(length >= 15 && w.result.metadataBytes <= enigmaMetadata, "LIMIT")
	record := enigmaCrypt(readEnigma(w.ctx, w.handle, w.limit, w.at, length), w.profile.headerState)
	w.at += length
	return record
}

// entryPath validates the fixed root and default folder levels, and every user path below them.
func entryPath(parent *vfsFrame, depth, kind int, name string, children int, complete bool) string {
	switch {
	case parent.root:
		requireEnigma(kind == 0 && name == "" && children > 0 && complete, "UNSUPPORTED")
	case depth == 2:
		requireEnigma(kind == 3 && name == "%DEFAULT FOLDER%", "UNSUPPORTED")
	default:
		requireEnigma(!enigmaForbidden.MatchString(name) && rules.SafePath(name), "PATH_INVALID")
		path := name
		if parent.path != "" {
			path = parent.path + "/" + name
		}
		requireEnigma(rules.SafePath(path), "PATH_INVALID")
		return path
	}
	return ""
}

// file records a payload row; repeated case-folded paths keep their first row and still consume their bytes.
func (w *vfsWalker) file(record bytesView, tail, children int, path string) {
	requireEnigma(children == 0 && path != "", "UNSUPPORTED")
	size, stored := enigmaFileRecord(record, tail)
	w.total += size
	requireEnigma(stored <= w.limit-w.at && w.total <= enigmaTree, "LIMIT")
	requireEnigma(w.profile.compressed || size == stored)
	if key := rules.Upper(path); !w.seen[key] {
		w.result.rows = append(w.result.rows, &enigmaRow{
			name: path, sizeBytes: size, stored: stored, offset: w.at,
			payloadState: w.profile.payloadState, compressed: w.profile.compressed,
		})
		w.seen[key] = true
	}
	w.at += stored
}

// entry reads one directory entry and returns its children frame, or nil.
func (w *vfsWalker) entry(parent *vfsFrame, depth int) *vfsFrame {
	record := w.record()
	children := int(record.u32(8))
	name, end := cstring(record, 12)
	kind, tail := record.at(end), end+1
	requireEnigma(children <= enigmaEntries && tail <= len(record), "LIMIT")
	path := entryPath(parent, depth, kind, name, children, tail == len(record))
	switch kind {
	case 2:
		w.file(record, tail, children, path)
	case 3:
		requireEnigma(tail+29 == len(record), "UNSUPPORTED")
	default:
		requireEnigma(kind == 0 && parent.root, "UNSUPPORTED")
	}
	if children > 0 {
		return &vfsFrame{count: children, path: path}
	}
	return nil
}

// enigmaVFS reads the whole bounded directory, preserving exact names and native preorder.
func enigmaVFS(ctx context.Context, handle *content.Handle, sourceSize int64, profile *vfsProfile) *vfsResult {
	timestamp := enigmaHeaders(ctx, handle, sourceSize, profile)
	w := &vfsWalker{
		ctx: ctx, handle: handle, profile: profile, seen: map[string]bool{},
		result: &vfsResult{timestamp: timestamp, metadataBytes: 120},
		at:     profile.base + 120, limit: profile.base + profile.packageSize,
	}
	stack := []*vfsFrame{{count: 1, root: true}}
	for count := 0; len(stack) > 0; {
		if ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		parent := stack[len(stack)-1]
		if parent.count == 0 {
			stack = stack[:len(stack)-1]
			continue
		}
		parent.count--
		count++
		requireEnigma(count <= enigmaEntries && len(stack) <= 128, "LIMIT")
		if child := w.entry(parent, len(stack)); child != nil {
			stack = append(stack, child)
		}
	}
	requireEnigma(w.at == w.limit && len(w.result.rows) > 0)
	return w.result
}

// enigmaReader streams one decoded VFS file.
type enigmaReader struct {
	ctx      context.Context
	handle   *content.Handle
	size     int64
	row      *enigmaRow
	position int64
	block    int
	previous int64
	pending  []byte
	started  bool
}

func (r *enigmaReader) Read(buffer []byte) (int, error) {
	for len(r.pending) == 0 {
		if !r.next() {
			return 0, errEOF
		}
	}
	read := copy(buffer, r.pending)
	r.pending = r.pending[read:]
	return read, nil
}

func (r *enigmaReader) next() bool {
	row := r.row
	if !row.compressed {
		if r.position >= row.sizeBytes {
			return false
		}
		length := min(8192, row.sizeBytes-r.position)
		r.pending = enigmaCrypt(readEnigma(r.ctx, r.handle, r.size, row.offset+r.position, length), row.payloadState)
		r.position += length
		return true
	}
	count := int((row.sizeBytes + 65535) / 65536)
	if !r.started {
		r.started, r.previous = true, int64(count*12)
		requireEnigma(r.previous <= row.stored && r.previous <= enigmaMetadata, "LIMIT")
	}
	if r.block == count {
		requireEnigma(r.previous == row.stored)
		return false
	}
	index := r.block
	r.block++
	record := enigmaCrypt(readEnigma(r.ctx, r.handle, r.size, row.offset+int64(index*12), 12), row.payloadState)
	offset, size := enigmaNumber(record, 0), int64(record.u32(8))
	expanded := min(65536, row.sizeBytes-int64(index)*65536)
	requireEnigma(offset == r.previous && size > 0 && size <= 128*1024 && size <= row.stored-offset)
	packed := enigmaCrypt(readEnigma(r.ctx, r.handle, r.size, row.offset+offset, size), row.payloadState)
	r.pending = enigmaDepack(r.ctx, packed, int(expanded), false)
	r.previous = offset + size
	return true
}

var defaultFolder = "%DEFAULT FOLDER%\\"

func externalFiles(input *pipeline.Context, prefix string, masks []string) []*rules.File {
	var order []string
	files := map[string]*rules.File{}
	for _, mask := range masks {
		requireEnigma(strings.HasPrefix(mask, defaultFolder), "UNSUPPORTED")
		relative := strings.ReplaceAll(mask[len(defaultFolder):], `\`, "/")
		valid := relative != "" && !strings.ContainsAny(relative, ":%") && !hasControlBelow32(relative)
		for _, part := range strings.Split(relative, "/") {
			valid = valid && part != "" && part != "." && part != ".."
		}
		requireEnigma(valid, "PATH_INVALID")
		pattern := regexp.MustCompile("(?i)^" + globPattern(prefix+relative) + "$")
		for index := range input.Files {
			file := &input.Files[index]
			if pattern.MatchString(file.LogicalKey) {
				if _, exists := files[file.LogicalKey]; !exists {
					order = append(order, file.LogicalKey)
				}
				files[file.LogicalKey] = file
			}
		}
	}
	requireEnigma(len(files) <= 64, "LIMIT")
	result := make([]*rules.File, 0, len(order))
	for _, key := range order {
		result = append(result, files[key])
	}
	return result
}

func globPattern(value string) string {
	var builder strings.Builder
	for _, character := range value {
		switch character {
		case '*':
			builder.WriteString("[^/]*")
		case '?':
			builder.WriteString("[^/]")
		case '.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\':
			builder.WriteRune('\\')
			builder.WriteRune(character)
		default:
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

type enigmaPackage struct {
	*vfsResult
	sourceKey string
}

type enigmaPlan struct {
	file     *rules.File
	sources  []*rules.File
	rows     []*enigmaRow
	evidence map[string]any
}

func enigmaProbe(input *pipeline.Context) ([]*pipeline.Plan, error) {
	return guarded(func() ([]*pipeline.Plan, error) { return enigmaProbeUnguarded(input) })
}

func enigmaProbeUnguarded(input *pipeline.Context) ([]*pipeline.Plan, error) {
	var plans []*pipeline.Plan
	for index := range input.Files {
		file := &input.Files[index]
		if !executable.MatchString(file.LogicalKey) {
			continue
		}
		if input.Ctx.Err() != nil {
			return nil, rules.Fail("RUNTIME_CANCELLED")
		}
		if plan := enigmaFilePlan(input, file); plan != nil {
			plans = append(plans, plan)
		}
	}
	return plans, nil
}

func inspectEnigma(input *pipeline.Context, file *rules.File) (*enigmaProfile, *vfsResult, *externalConfig) {
	locator, err := input.Locator(file)
	if err != nil {
		panic(err)
	}
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	size := int64(locator.SizeBytes)
	profile := enigmaPE(input.Ctx, handle, size)
	if profile == nil {
		return nil, nil, nil
	}
	directory := enigmaVFS(input.Ctx, handle, size, &vfsProfile{
		base: profile.base, packageSize: profile.packageSize,
		headerState: profile.headerState, payloadState: profile.payloadState, compressed: profile.compressed,
	})
	return profile, directory, enigmaExternalConfig(input.Ctx, handle, size, profile.configuration)
}

func externalPackage(input *pipeline.Context, item *rules.File, external *externalConfig, compressed bool) *vfsResult {
	locator, err := input.Locator(item)
	if err != nil {
		panic(err)
	}
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	encrypted := external.encryptedHeader
	return enigmaVFS(input.Ctx, handle, int64(locator.SizeBytes), &vfsProfile{
		base: 0, packageSize: int64(locator.SizeBytes),
		headerState: external.headerState, payloadState: external.payloadState, compressed: compressed,
		encryptedHeader: &encrypted,
	})
}

// selectEnigmaRows: stable descending package timestamps match the native ordering; the first same-name node wins.
func selectEnigmaRows(packages []*enigmaPackage) []*enigmaRow {
	sort.SliceStable(packages, func(i, j int) bool { return packages[i].timestamp > packages[j].timestamp })
	names := map[string]bool{}
	var selected []*enigmaRow
	for _, pack := range packages {
		for _, row := range pack.rows {
			key := rules.Upper(row.name)
			if names[key] {
				continue
			}
			names[key] = true
			copied := *row
			copied.sourceKey = pack.sourceKey
			selected = append(selected, &copied)
		}
	}
	return selected
}

// foldedPaths maps case-folded logical paths to their content path; folded duplicates conflict.
func foldedPaths(files []rules.File) map[string]string {
	existing := map[string]string{}
	for _, item := range files {
		key := rules.Upper(item.LogicalKey)
		_, duplicate := existing[key]
		requireEnigma(!duplicate, "CONFLICT")
		existing[key] = item.LogicalKey
	}
	return existing
}

func shadowsSource(key string, sources []*rules.File) bool {
	for _, item := range sources {
		if key == rules.Upper(item.LogicalKey) {
			return true
		}
	}
	return false
}

// enigmaOutputs places each selected row; a row matching existing content overrides that file in place.
func enigmaOutputs(files []rules.File, sources []*rules.File, selected []*enigmaRow, prefix string,
) ([]string, []string) {
	existing := foldedPaths(files)
	var overrides []string
	outputs := make([]string, 0, len(sources)+len(selected))
	for _, item := range sources {
		outputs = append(outputs, item.LogicalKey)
	}
	for _, row := range selected {
		target := prefix + row.name
		key := rules.Upper(target)
		requireEnigma(rules.SafePath(target) && !shadowsSource(key, sources), "PATH_INVALID")
		row.logicalKey = target
		if old, exists := existing[key]; exists {
			overrides = append(overrides, old)
			row.logicalKey = old
		}
		outputs = append(outputs, row.logicalKey)
	}
	return outputs, overrides
}

func enigmaFilePlan(input *pipeline.Context, file *rules.File) *pipeline.Plan {
	profile, directory, external := inspectEnigma(input, file)
	if profile == nil {
		return nil
	}
	prefix := rules.Root(file.LogicalKey)
	sources := append([]*rules.File{file}, externalFiles(input, prefix, external.masks)...)
	keys := map[string]bool{}
	for _, item := range sources {
		keys[item.LogicalKey] = true
	}
	requireEnigma(len(keys) == len(sources), "CONFLICT")
	packages := []*enigmaPackage{{vfsResult: directory, sourceKey: file.LogicalKey}}
	candidates, metadata := len(directory.rows), directory.metadataBytes
	for _, item := range sources[1:] {
		found := externalPackage(input, item, external, profile.compressed)
		candidates += len(found.rows)
		metadata += found.metadataBytes
		requireEnigma(candidates <= enigmaEntries && metadata <= 32*1024*1024, "LIMIT")
		packages = append(packages, &enigmaPackage{vfsResult: found, sourceKey: item.LogicalKey})
	}
	selected := selectEnigmaRows(packages)
	outputs, overrides := enigmaOutputs(input.Files, sources, selected, prefix)
	evidence := map[string]any{
		"external": external.evidence, "externalPackages": len(sources) - 1,
		"shadowedVirtualFiles": candidates - len(selected),
	}
	for name, value := range profile.evidence {
		evidence[name] = value
	}
	claims := make([]string, len(sources))
	for index, item := range sources {
		claims[index] = item.LogicalKey
	}
	domain := file.LogicalKey
	return &pipeline.Plan{
		Format: "enigma-protector-vfs", Claims: claims, Outputs: outputs, Overrides: overrides,
		LaunchDomain: &domain, Data: &enigmaPlan{file: file, sources: sources, rows: selected, evidence: evidence},
	}
}

func enigmaConvert(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	return guarded(func() (*pipeline.Result, error) { return enigmaConvertUnguarded(input, plan) })
}

func enigmaConvertUnguarded(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	data := as[*enigmaPlan](plan.Data)
	var files []pipeline.OutputFile
	for _, item := range data.sources {
		locator, err := input.Locator(item)
		if err != nil {
			return nil, fmt.Errorf("locator: %w", err)
		}
		verifySource(input.Ctx, locator, item.SHA256)
		files = append(files, writeDestination(input, item.LogicalKey, &locatedReader{ctx: input.Ctx, locator: locator}))
		files = append(files, enigmaRows(input, locator, data.rows, item.LogicalKey)...)
		verifySource(input.Ctx, locator, item.SHA256)
	}
	audit := map[string]any{
		"format": plan.Format, "file": data.file.LogicalKey, "sourceSha256": data.file.SHA256,
		"extractedFiles": len(data.rows), "overrides": plan.Overrides, "nativeCodeExecuted": false,
	}
	for name, value := range data.evidence {
		audit[name] = value
	}
	writeAudit(input.AuditRoot, "enigma-"+rules.HashBytes([]byte(data.file.LogicalKey))+".json", audit)
	count := 1
	return &pipeline.Result{Files: files, Summary: &pipeline.Summary{
		ArchiveCount: &count, VerifiedEntries: len(data.rows),
		Details: []map[string]any{},
	}}, nil
}

func enigmaRows(input *pipeline.Context, locator *content.Locator, rows []*enigmaRow,
	source string,
) []pipeline.OutputFile {
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	var files []pipeline.OutputFile
	for _, row := range rows {
		if row.sourceKey != source {
			continue
		}
		output := writeDestination(input, row.logicalKey,
			&enigmaReader{ctx: input.Ctx, handle: handle, size: int64(locator.SizeBytes), row: row})
		requireEnigma(int64(output.SizeBytes) == row.sizeBytes)
		files = append(files, output)
	}
	return files
}

// EnigmaProtector is the KiriKiri Enigma Protector VFS container registration.
var EnigmaProtector = &pipeline.Plugin{
	ID: "enigma-protector-vfs", Version: 1, Phase: "container", Priority: 100,
	Platforms: []string{"kirikiri"}, Formats: []string{"enigma-protector-vfs"}, Probe: enigmaProbe, Convert: enigmaConvert,
}
