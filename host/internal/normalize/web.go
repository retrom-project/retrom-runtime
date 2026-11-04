package normalize

import (
	"bytes"
	"compress/flate"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

const (
	webHeaderMax = 16 * 1024 * 1024
	webTreeMax   = 16 * 1024 * 1024 * 1024
)

var (
	webEntry  = regexp.MustCompile(`(?i)(?:^|/)index\.html$`)
	asarName  = regexp.MustCompile(`(?i)(?:^|/)app\.asar$`)
	digitsRow = regexp.MustCompile(`^\d+$`)
)

func fail(code string) *rules.Failure { return rules.Fail(code) }

func hasWebEntry(input *pipeline.Context) bool {
	for _, file := range input.Files {
		if webEntry.MatchString(file.LogicalKey) {
			return true
		}
	}
	return false
}

func readContainer(handle *content.Handle, offset, size int64) bytesView {
	data := make([]byte, size)
	for read := int64(0); read < size; {
		count, err := handle.ReadAt(data[read:], offset+read)
		if err != nil || count == 0 {
			panic(fail("RUNTIME_PROJECT_CONTAINER_INVALID"))
		}
		read += int64(count)
	}
	return data
}

func withHandle[T any](locator *content.Locator, action func(*content.Handle) T) T {
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	return action(handle)
}

func hasSignature(locator *content.Locator, signature []byte) bool {
	if locator.SizeBytes < float64(len(signature)) {
		return false
	}
	return withHandle(locator, func(handle *content.Handle) bool {
		return bytes.Equal(readContainer(handle, 0, int64(len(signature))), signature)
	})
}

func zipEnd(tail bytesView) int {
	for at := len(tail) - 22; at >= 0; at-- {
		if tail.u32(at) == 0x06054b50 && at+22+tail.u16(at+20) == len(tail) {
			return at
		}
	}
	return -1
}

func hasZIP(locator *content.Locator) bool {
	size := int64(locator.SizeBytes)
	if size < 22 {
		return false
	}
	return withHandle(locator, func(handle *content.Handle) bool {
		length := min(size, 65557)
		return zipEnd(readContainer(handle, size-length, length)) >= 0
	})
}

type webRow struct {
	logicalKey      string
	sourceKey       string
	offset          int64
	compressedBytes int64
	sizeBytes       int64
	crc32           *uint32
	deflate         bool
	expectedSHA256  string
}

type webPlan struct {
	file *rules.File
	rows []*webRow
}

func asarProbe(input *pipeline.Context) ([]*pipeline.Plan, error) {
	return guarded(func() ([]*pipeline.Plan, error) { return asarProbeUnguarded(input) })
}

func asarProbeUnguarded(input *pipeline.Context) ([]*pipeline.Plan, error) {
	var plans []*pipeline.Plan
	if hasWebEntry(input) {
		return nil, nil
	}
	for index := range input.Files {
		file := &input.Files[index]
		if !asarName.MatchString(file.LogicalKey) {
			continue
		}
		locator, err := input.Locator(file)
		if err != nil {
			return nil, fmt.Errorf("locator: %w", err)
		}
		if !hasSignature(locator, []byte{4, 0, 0, 0}) {
			continue
		}
		rows := withHandle(locator, func(handle *content.Handle) []*webRow { return asarEntries(handle, file, input) })
		claims, outputs, entry := []string{file.LogicalKey}, []string{}, false
		for _, row := range rows {
			if row.sourceKey != "" {
				claims = append(claims, row.sourceKey)
			}
			outputs = append(outputs, row.logicalKey)
			entry = entry || row.logicalKey == "index.html"
		}
		if !entry {
			return nil, fail("RUNTIME_ENTRY_MISSING")
		}
		domain := file.LogicalKey
		plans = append(plans, &pipeline.Plan{
			Format: "electron-asar", LaunchDomain: &domain, Claims: claims, Outputs: outputs,
			Data: &webPlan{file: file, rows: rows},
		})
	}
	return plans, nil
}

var exeName = regexp.MustCompile(`(?i)\.exe$`)

func embeddedZIPProbe(input *pipeline.Context) ([]*pipeline.Plan, error) {
	return guarded(func() ([]*pipeline.Plan, error) { return embeddedZIPProbeUnguarded(input) })
}

func embeddedZIPProbeUnguarded(input *pipeline.Context) ([]*pipeline.Plan, error) {
	var plans []*pipeline.Plan
	if hasWebEntry(input) {
		return nil, nil
	}
	for index := range input.Files {
		file := &input.Files[index]
		if !exeName.MatchString(file.LogicalKey) {
			continue
		}
		locator, err := input.Locator(file)
		if err != nil {
			return nil, fmt.Errorf("locator: %w", err)
		}
		if !hasSignature(locator, []byte("MZ")) || !hasZIP(locator) {
			continue
		}
		rows := withHandle(locator, func(handle *content.Handle) []*webRow { return embeddedZIPEntries(handle, file.Size()) })
		outputs, entry := []string{}, false
		for _, row := range rows {
			outputs = append(outputs, row.logicalKey)
			entry = entry || row.logicalKey == "index.html"
		}
		if !entry {
			continue
		}
		domain := file.LogicalKey
		plans = append(plans, &pipeline.Plan{
			Format: "nw-embedded-zip", LaunchDomain: &domain, Claims: []string{file.LogicalKey},
			Outputs: outputs, Data: &webPlan{file: file, rows: rows},
		})
	}
	return plans, nil
}

type asarCollector struct {
	input     *pipeline.Context
	sourceKey string
	size      int64
	start     int64
	result    []*webRow
	folded    map[string]bool
}

func (c *asarCollector) collect(raw json.RawMessage, root string, depth int, unpacked bool) {
	invalid := fail("RUNTIME_ASAR_INVALID")
	var value map[string]json.RawMessage
	if json.Unmarshal(raw, &value) != nil || value == nil || !truthyJSON(value["files"]) || depth > 32 {
		panic(invalid)
	}
	names, nodes, err := rules.ObjectKeys(value["files"])
	if err != nil {
		panic(invalid)
	}
	for _, name := range names {
		key := root + name
		node := c.node(key, nodes[name])
		packedFlag := string(node["unpacked"]) == "true"
		if truthyJSON(node["files"]) {
			c.collect(nodes[name], key+"/", depth+1, unpacked || packedFlag)
			continue
		}
		if unpacked || packedFlag {
			c.sidecar(key, node)
			continue
		}
		c.packed(key, node)
	}
}

// node decodes one bounded, non-link directory entry.
func (c *asarCollector) node(key string, raw json.RawMessage) map[string]json.RawMessage {
	var node map[string]json.RawMessage
	if !rules.SafePath(key) || len(c.result) >= 100000 || json.Unmarshal(raw, &node) != nil || node == nil ||
		truthyJSON(node["link"]) {
		panic(fail("RUNTIME_ASAR_INVALID"))
	}
	return node
}

// asarOffset is a decimal string offset within the safe integer range, or -1.
func asarOffset(raw json.RawMessage) int64 {
	var text string
	if json.Unmarshal(raw, &text) != nil || !digitsRow.MatchString(text) {
		return -1
	}
	parsed, err := strconv.ParseFloat(text, 64)
	if err != nil || parsed > 1<<53-1 {
		return -1
	}
	return int64(parsed)
}

// packed records a file stored inside the archive body.
func (c *asarCollector) packed(key string, node map[string]json.RawMessage) {
	size, sizeOK := safeNumber(node["size"])
	offset := asarOffset(node["offset"])
	if !sizeOK || size < 0 || offset < 0 || c.start+offset+size > c.size || c.folded[rules.Lower(key)] {
		panic(fail("RUNTIME_ASAR_INVALID"))
	}
	c.folded[rules.Lower(key)] = true
	c.result = append(c.result, &webRow{
		logicalKey: key, offset: c.start + offset, compressedBytes: size,
		sizeBytes: size,
	})
}

func (c *asarCollector) sidecar(key string, node map[string]json.RawMessage) {
	sidecarKey := c.sourceKey + ".unpacked/" + key
	sidecar := rules.FindFile(c.input.Files, sidecarKey)
	size, ok := safeNumber(node["size"])
	locator, located := c.input.Locators[sidecarKey]
	if sidecar == nil || !ok || sidecar.SizeBytes != float64(size) || !located || locator.SizeBytes != sidecar.SizeBytes {
		panic(fail("RUNTIME_ASAR_SIDECAR_MISSING"))
	}
	c.result = append(c.result, &webRow{
		logicalKey: key, sourceKey: sidecarKey, compressedBytes: size, sizeBytes: size,
		expectedSHA256: sidecar.SHA256,
	})
}

func truthyJSON(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case float64:
		return typed != 0
	case string:
		return typed != ""
	default:
		return true
	}
}

func safeNumber(raw json.RawMessage) (int64, bool) {
	var value float64
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil || value != float64(int64(value)) || value > 1<<53-1 ||
		value < -(1<<53-1) {
		return 0, false
	}
	return int64(value), true
}

func asarEntries(handle *content.Handle, file *rules.File, input *pipeline.Context) []*webRow {
	prefix := readContainer(handle, 0, 16)
	headerBytes, payloadBytes, jsonBytes := prefix.u32(4), prefix.u32(8), prefix.u32(12)
	if prefix.u32(0) != 4 || headerBytes != payloadBytes+4 || payloadBytes < 4 || headerBytes > webHeaderMax ||
		jsonBytes > payloadBytes-4 {
		panic(fail("RUNTIME_ASAR_INVALID"))
	}
	text, ok := textcodec.Decode(readContainer(handle, 16, int64(jsonBytes)), "utf-8", false)
	if !ok || !json.Valid([]byte(text)) {
		panic(internalError("asar header is not JSON"))
	}
	collector := &asarCollector{
		input: input, sourceKey: file.LogicalKey, size: file.Size(), start: 8 + int64(headerBytes),
		folded: map[string]bool{},
	}
	collector.collect(json.RawMessage(text), "", 0, false)
	return validateRows(collector.result)
}

func embeddedZIPEntries(handle *content.Handle, size int64) []*webRow {
	invalid := fail("RUNTIME_EMBEDDED_ZIP_INVALID")
	length := min(size, 65557)
	tail := readContainer(handle, size-length, length)
	end := zipEnd(tail)
	if end < 0 || tail.u32(end+4) != 0 {
		panic(invalid)
	}
	count, directoryBytes, offset := tail.u16(end+10), int64(tail.u32(end+12)), int64(tail.u32(end+16))
	if count == 65535 || count != tail.u16(end+8) || directoryBytes > webHeaderMax {
		panic(invalid)
	}
	prefix := size - length + int64(end) - directoryBytes - offset
	if prefix < 0 {
		panic(invalid)
	}
	directory := readContainer(handle, prefix+offset, directoryBytes)
	var rows []*webRow
	at := 0
	for range count {
		if at+46 > len(directory) || directory.u32(at) != 0x02014b50 || directory.u16(at+8)&1 != 0 {
			panic(invalid)
		}
		nameBytes, extra, comment := directory.u16(at+28), directory.u16(at+30), directory.u16(at+32)
		name, ok := textcodec.Decode(directory[at+46:min(len(directory), at+46+nameBytes)], "utf-8", false)
		if !ok {
			panic(internalError("The encoded data was not valid for encoding utf-8"))
		}
		if !rules.SafePath(strings.TrimSuffix(name, "/")) {
			panic(invalid)
		}
		if !strings.HasSuffix(name, "/") {
			rows = append(rows, zipRow(handle, directory, at, name, prefix, offset))
		}
		at += 46 + nameBytes + extra + comment
	}
	if at != int(directoryBytes) {
		panic(invalid)
	}
	return validateRows(rows)
}

func zipRow(handle *content.Handle, directory bytesView, at int, name string, prefix, offset int64) *webRow {
	invalid := fail("RUNTIME_EMBEDDED_ZIP_INVALID")
	method := directory.u16(at + 10)
	localOffset := prefix + int64(directory.u32(at+42))
	local := readContainer(handle, localOffset, 30)
	if method != 0 && method != 8 || local.u32(0) != 0x04034b50 || directory.u32(at+38)>>16&0xf000 == 0xa000 {
		panic(invalid)
	}
	dataOffset := localOffset + 30 + int64(local.u16(26)) + int64(local.u16(28))
	compressed := int64(directory.u32(at + 20))
	if dataOffset+compressed > prefix+offset {
		panic(invalid)
	}
	checksum := directory.u32(at + 16)
	return &webRow{
		logicalKey: name, offset: dataOffset, compressedBytes: compressed, sizeBytes: int64(directory.u32(at + 24)),
		crc32: &checksum, deflate: method == 8,
	}
}

func validateRows(rows []*webRow) []*webRow {
	var sorted []*webRow
	names := map[string]bool{}
	for _, row := range rows {
		if row.sourceKey == "" {
			sorted = append(sorted, row)
		}
		names[rules.Lower(row.logicalKey)] = true
	}
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].offset < sorted[j].offset })
	valid := len(rows) > 0 && len(names) == len(rows)
	for index := 1; index < len(sorted); index++ {
		valid = valid && sorted[index].offset >= sorted[index-1].offset+sorted[index-1].compressedBytes
	}
	if !valid {
		panic(fail("RUNTIME_PROJECT_CONTAINER_INVALID"))
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].logicalKey < rows[j].logicalKey })
	return rows
}

type rangeReader struct {
	ctx           context.Context
	handle        *content.Handle
	position, end int64
}

func (r *rangeReader) Read(buffer []byte) (int, error) {
	if r.position >= r.end {
		return 0, io.EOF
	}
	checkCancel(r.ctx)
	chunk := buffer[:min(int64(len(buffer)), r.end-r.position, 65536)]
	read, err := r.handle.ReadAt(chunk, r.position)
	if err != nil {
		return read, fmt.Errorf("read range: %w", err)
	}
	if read == 0 {
		return 0, fail("RUNTIME_CONTENT_CHANGED")
	}
	r.position += int64(read)
	return read, nil
}

// verifyingReader enforces the declared size while hashing the decoded stream.
type verifyingReader struct {
	source   io.Reader
	limit    int64
	length   int64
	checksum uint32
	hash     interface{ Write([]byte) (int, error) }
}

func (r *verifyingReader) Read(buffer []byte) (int, error) {
	read, err := r.source.Read(buffer)
	if read > 0 {
		r.length += int64(read)
		if r.length > r.limit {
			return 0, fail("RUNTIME_CONTENT_CHANGED")
		}
		r.checksum = crc32.Update(r.checksum, crc32.IEEETable, buffer[:read])
	}
	if err == nil {
		return read, nil
	}
	if errors.Is(err, io.EOF) {
		return read, io.EOF
	}
	return read, fmt.Errorf("verified stream: %w", err)
}

func webConvert(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	return guarded(func() (*pipeline.Result, error) { return webConvertUnguarded(input, plan) })
}

func webConvertUnguarded(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	data := as[*webPlan](plan.Data)
	source, err := input.Locator(data.file)
	if err != nil {
		return nil, fmt.Errorf("locator: %w", err)
	}
	verifySource(input.Ctx, source, data.file.SHA256)
	var files []pipeline.OutputFile
	total := int64(0)
	for _, row := range data.rows {
		checkCancel(input.Ctx)
		total += row.sizeBytes
		if total > webTreeMax {
			return nil, fail("RUNTIME_PROJECT_TOO_LARGE")
		}
		locator := source
		if row.sourceKey != "" {
			value := input.Locators[row.sourceKey]
			locator = &value
		}
		files = append(files, webRowOutput(input, locator, row))
	}
	verifySource(input.Ctx, source, data.file.SHA256)
	count := 1
	return &pipeline.Result{Files: files, Summary: &pipeline.Summary{
		ArchiveCount:    &count,
		VerifiedEntries: len(files),
	}}, nil
}

func webRowOutput(input *pipeline.Context, locator *content.Locator, row *webRow) pipeline.OutputFile {
	if row.offset < 0 || row.compressedBytes < 0 || row.offset+row.compressedBytes > int64(locator.SizeBytes) {
		panic(fail("RUNTIME_CONTENT_RANGE_INVALID"))
	}
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	var stream io.Reader = &rangeReader{
		ctx: input.Ctx, handle: handle, position: row.offset,
		end: row.offset + row.compressedBytes,
	}
	if row.deflate {
		stream = flate.NewReader(stream)
	}
	verifier := &verifyingReader{source: stream, limit: row.sizeBytes, hash: sha256.New()}
	output := writeDestination(input, row.logicalKey, verifier)
	digest := output.SHA256
	if verifier.length != row.sizeBytes || row.crc32 != nil && verifier.checksum != *row.crc32 ||
		row.expectedSHA256 != "" && row.expectedSHA256 != digest {
		panic(fail("RUNTIME_CONTENT_CHANGED"))
	}
	return output
}

// ElectronAsar is the TyranoScript Electron asar container registration.
var ElectronAsar = &pipeline.Plugin{
	ID: "electron-asar", Phase: "container", Version: 1, Priority: 200,
	Platforms: []string{"tyranoscript"}, Formats: []string{"electron-asar"}, Probe: asarProbe, Convert: webConvert,
}

// NWEmbeddedZIP is the TyranoScript NW.js embedded ZIP container registration.
var NWEmbeddedZIP = &pipeline.Plugin{
	ID: "nw-embedded-zip", Phase: "container", Version: 1, Priority: 300,
	Platforms: []string{"tyranoscript"}, Formats: []string{"nw-embedded-zip"}, Probe: embeddedZIPProbe,
	Convert: webConvert,
}
