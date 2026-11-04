package normalize

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"unicode/utf8"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

// requireString validates a bounded NUL-terminated UTF-8 catalog string.
func requireString(data bytesView, offset int) {
	requireMolebox(offset > 0 && offset < len(data))
	end := indexByte(data, 0, offset)
	requireMolebox(end >= offset && end-offset <= 4096)
	requireMolebox(utf8.Valid(data[offset:end]))
}

func indexByte(data []byte, value byte, from int) int {
	for index := from; index < len(data); index++ {
		if data[index] == value {
			return index
		}
	}
	return -1
}

var (
	forbiddenName = regexp.MustCompile(`[\\/:*?"<>|]`)
	trailingDot   = regexp.MustCompile(`[. ]$`)
)

func nodeName(metadata []byte, offset, count int, root bool) string {
	if root {
		requireMolebox(offset == 0 && count == 0)
		return ""
	}
	requireMolebox(offset > 0 && count > 0 && count <= 2048, "RUNTIME_MOLEBOX_UNSUPPORTED")
	name, ok := textcodec.Decode(moleboxRange(metadata, int64(offset), int64(count*2)), "utf-16le", true)
	requireMolebox(ok, "RUNTIME_MOLEBOX_PATH_INVALID")
	requireMolebox(!forbiddenName.MatchString(name) && !trailingDot.MatchString(name) && rules.SafePath(name),
		"RUNTIME_MOLEBOX_PATH_INVALID")
	return name
}

type moleboxBlockRecord struct {
	offset       int64
	packed, size int
	flags        int
	crc16        uint16
}

type moleboxRow struct {
	name       string
	sizeBytes  int64
	key        []byte
	table      []byte
	blocks     []moleboxBlockRecord
	logicalKey string
}

type moleboxBudget struct {
	metadata, tree int64
	blocks         int
}

type span struct{ start, end int64 }

func blocksAt(metadata bytesView, offset, count int, fileSize, base, dataEnd int64, spans *[]span,
	budget *moleboxBudget,
) []moleboxBlockRecord {
	requireMolebox(int64(count) == (fileSize+moleboxBlock-1)/moleboxBlock)
	requireMolebox(count <= 1000000-budget.blocks, "RUNTIME_MOLEBOX_LIMIT")
	budget.blocks += count
	moleboxRange(metadata, int64(offset), int64(count*12))
	blocks := make([]moleboxBlockRecord, 0, count)
	for index := range count {
		at := offset + index*12
		packed, size, flags := metadata.u16(at), metadata.u16(at+2), metadata.u16(at+4)
		crc, position := uint16(metadata.u16(at+6)), base+int64(metadata.u32(at+8))
		requireMolebox(flags&^6 == 0, "RUNTIME_MOLEBOX_UNSUPPORTED")
		expected := min(fileSize-int64(index)*moleboxBlock, moleboxBlock)
		layout := flags&2 != 0 || flags&4 != 0 && packed == (size+7)/8*8 || flags&4 == 0 && packed == size
		requireMolebox(packed > 0 && int64(size) == expected && position >= base && position <= dataEnd &&
			int64(packed) <= dataEnd-position && (flags&4 == 0 || packed%8 == 0) && layout)
		blocks = append(blocks, moleboxBlockRecord{offset: position, packed: packed, size: size, flags: flags, crc16: crc})
		*spans = append(*spans, span{position, position + int64(packed)})
	}
	return blocks
}

type treeWalker struct {
	metadata bytesView
	expected map[uint32]bool
	visited  map[uint32]bool
	paths    map[string]bool
	rows     []*moleboxRow
	spans    []span
	base     int64
	dataEnd  int64
	key      []byte
	table    []byte
	budget   *moleboxBudget
}

func (w *treeWalker) walk(offset uint32, parent string, depth int, root bool) {
	requireMolebox(depth <= 32 && len(w.visited) < moleboxEntries+1, "RUNTIME_MOLEBOX_LIMIT")
	requireMolebox(!w.visited[offset])
	w.visited[offset] = true
	node := bytesView(moleboxRange(w.metadata, int64(offset), 52))
	flags := node.u32(40)
	directory := flags&0x80000000 != 0
	requireMolebox(node.u32(0) == 0 && node.u32(4) == 0 && node.u32(36) == 0)
	if directory {
		requireMolebox(flags == 0x80000000, "RUNTIME_MOLEBOX_UNSUPPORTED")
	} else {
		requireMolebox(flags&^6 == 0, "RUNTIME_MOLEBOX_UNSUPPORTED")
	}
	// Hidden names and conditional physical-file fallback change native lookup; they cannot be loose files.
	name := nodeName(w.metadata, int(node.u32(8)), int(node.u32(12)), root)
	path := ""
	if !root {
		path = parent + name
		requireMolebox(rules.SafePath(path), "RUNTIME_MOLEBOX_PATH_INVALID")
		requireMolebox(w.expected[offset] && !w.paths[rules.Upper(path)])
		w.paths[rules.Upper(path)] = true
	} else {
		requireMolebox(directory)
	}
	length, children := int64(node.u32(44)), int(node.u32(48))
	if directory {
		requireMolebox(length == 0 && children <= moleboxEntries, "RUNTIME_MOLEBOX_LIMIT")
		pointers := bytesView(moleboxRange(w.metadata, int64(offset)+52, int64(children*4)))
		prefix := ""
		if path != "" {
			prefix = path + "/"
		}
		for index := range children {
			w.walk(pointers.u32(index*4), prefix, depth+1, false)
		}
		return
	}
	requireMolebox(length <= moleboxFile && w.budget.tree+length <= moleboxTree, "RUNTIME_MOLEBOX_LIMIT")
	w.budget.tree += length
	w.rows = append(w.rows, &moleboxRow{
		name: path, sizeBytes: length, key: w.key, table: w.table,
		blocks: blocksAt(w.metadata, int(offset)+52, children, length, w.base, w.dataEnd, &w.spans, w.budget),
	})
}

func treeRows(metadata bytesView, rootOffset, listOffset uint32, count int, base, dataEnd int64, key, table []byte,
	budget *moleboxBudget,
) []*moleboxRow {
	requireMolebox(count > 0 && count <= moleboxEntries, "RUNTIME_MOLEBOX_LIMIT")
	listed := bytesView(moleboxRange(metadata, int64(listOffset), int64(count*4)))
	walker := &treeWalker{
		metadata: metadata, expected: map[uint32]bool{}, visited: map[uint32]bool{}, paths: map[string]bool{},
		base: base, dataEnd: dataEnd, key: key, table: table, budget: budget,
	}
	for index := range count {
		walker.expected[listed.u32(index*4)] = true
	}
	requireMolebox(len(walker.expected) == count)
	walker.walk(rootOffset, "", 0, true)
	requireMolebox(len(walker.visited) == len(walker.expected)+1)
	for offset := range walker.expected {
		requireMolebox(walker.visited[offset])
	}
	sort.SliceStable(walker.spans, func(i, j int) bool { return walker.spans[i].start < walker.spans[j].start })
	for index := 1; index < len(walker.spans); index++ {
		requireMolebox(walker.spans[index].start >= walker.spans[index-1].end)
	}
	return walker.rows
}

var steelpack = []byte("STELPACK")

func packageRows(ctx context.Context, handle *content.Handle, size, footer int64, seed []byte, loader *moleboxLoader,
	budget *moleboxBudget,
) []*moleboxRow {
	key := moleboxKey(seed)
	header := bytesView(decodeMolebox(readAt(ctx, handle, size, footer, 48), key, loader.table, true))
	repeated := make([]byte, 60)
	for index := range repeated {
		repeated[index] = seed[index%15]
	}
	marker := decodeMolebox(decodeMolebox(steelpack, repeated, loader.table, false), repeated, loader.table, false)
	requireMolebox(string(header[40:48]) == string(marker), "RUNTIME_MOLEBOX_UNSUPPORTED")
	metadataOffset, length := int64(header.u32(0)), int64(header.u32(4))
	base := footer - int64(header.u32(12))
	requireMolebox(length > 0 && length <= moleboxMetadata && budget.metadata+length <= moleboxImage,
		"RUNTIME_MOLEBOX_LIMIT")
	requireMolebox(base >= loader.dataStart && metadataOffset >= base && metadataOffset == footer-length && length%8 == 0)
	requireMolebox(header.u32(32) == 0 && header.u32(36) == 0, "RUNTIME_MOLEBOX_INJECTION_UNSUPPORTED")
	metadata := decodeMolebox(readAt(ctx, handle, size, metadataOffset, length), key, loader.table, true)
	requireMolebox(crc32.ChecksumIEEE(metadata) == header.u32(16))
	budget.metadata += length
	return treeRows(metadata, header.u32(8), header.u32(20), int(header.u32(24)), base, metadataOffset, key,
		loader.table, budget)
}

type moleboxIndex struct {
	rows     []*moleboxRow
	evidence map[string]any
}

// inspectMolebox exposes resources of one immutable PE slice; named VFS files retain native mount order.
func inspectMolebox(ctx context.Context, handle *content.Handle, size int64) *moleboxIndex {
	loader := readMoleboxLoader(ctx, handle, size)
	if loader == nil {
		return nil
	}
	requireMolebox(loader.catalogOffset >= loader.dataStart+8)
	sum := md5.Sum(loader.password)
	key := moleboxKey(sum[:])
	footer := bytesView(decodeMolebox(readAt(ctx, handle, size, loader.catalogOffset, 8), key, loader.table, false))
	length := int64(footer.u32(0))
	requireMolebox(length > 0 && length <= 65536 && length%8 == 0, "RUNTIME_MOLEBOX_LIMIT")
	requireMolebox(loader.catalogOffset-length >= loader.dataStart)
	catalog := bytesView(decodeMolebox(readAt(ctx, handle, size, loader.catalogOffset-length, length), key,
		loader.table, true))
	requireMolebox(crc32.ChecksumIEEE(catalog) == footer.u32(4) && length >= 16)
	list, count, mounts, mountCount := int(catalog.u32(0)), int(catalog.u32(4)), int(catalog.u32(8)), int(catalog.u32(12))
	requireMolebox(count > 0 && count <= moleboxPackages && mountCount == count, "RUNTIME_MOLEBOX_UNSUPPORTED")
	moleboxRange(catalog, int64(list), int64(count*8))
	moleboxRange(catalog, int64(mounts), int64(count*24))
	selected := map[string]*moleboxRow{}
	budget := &moleboxBudget{metadata: length}
	for index := range count {
		if ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		mount, entry := mounts+index*24, list+index*8
		// Native mount records use their ordinal to select the embedded package; the name is descriptive.
		requireMolebox(catalog.u32(mount) == 1, "RUNTIME_MOLEBOX_UNSUPPORTED")
		requireString(catalog, int(catalog.u32(mount+4)))
		requireString(catalog, int(catalog.u32(entry+4)))
		position := int64(catalog.u32(entry))
		requireMolebox(position+48 <= loader.catalogOffset-length)
		for _, row := range packageRows(ctx, handle, size, position, catalog[mount+8:mount+24], loader, budget) {
			selected[rules.Upper(row.name)] = row
		}
	}
	requireMolebox(len(selected) > 0 && len(selected) <= moleboxEntries, "RUNTIME_MOLEBOX_LIMIT")
	rows := make([]*moleboxRow, 0, len(selected))
	for _, row := range selected {
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].name < rows[j].name })
	evidence := map[string]any{}
	for name, value := range loader.evidence {
		evidence[name] = value
	}
	evidence["packageCount"], evidence["metadataBytes"] = count, budget.metadata
	evidence["verifiedMetadataCRC32"], evidence["sourceBlocks"] = count+1, budget.blocks
	return &moleboxIndex{rows: rows, evidence: evidence}
}

var executable = regexp.MustCompile(`(?i)\.exe$`)

type moleboxPlan struct {
	file     *rules.File
	rows     []*moleboxRow
	evidence map[string]any
}

func moleboxProbe(input *pipeline.Context) ([]*pipeline.Plan, error) {
	return guarded(func() ([]*pipeline.Plan, error) { return moleboxProbeUnguarded(input) })
}

func moleboxProbeUnguarded(input *pipeline.Context) ([]*pipeline.Plan, error) {
	var plans []*pipeline.Plan
	for index := range input.Files {
		file := &input.Files[index]
		if !executable.MatchString(file.LogicalKey) {
			continue
		}
		if input.Ctx.Err() != nil {
			return nil, rules.Fail("RUNTIME_CANCELLED")
		}
		locator, err := input.Locator(file)
		if err != nil {
			return nil, fmt.Errorf("locator: %w", err)
		}
		found := inspectLocated(input.Ctx, locator)
		if found == nil {
			continue
		}
		plans = append(plans, moleboxFilePlan(input, file, found))
	}
	return plans, nil
}

func inspectLocated(ctx context.Context, locator *content.Locator) *moleboxIndex {
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	return inspectMolebox(ctx, handle, int64(locator.SizeBytes))
}

func moleboxFilePlan(input *pipeline.Context, file *rules.File, found *moleboxIndex) *pipeline.Plan {
	prefix := rules.Root(file.LogicalKey)
	existing := map[string]string{}
	for _, item := range input.Files {
		key := rules.Upper(item.LogicalKey)
		_, duplicate := existing[key]
		requireMolebox(!duplicate, "RUNTIME_NORMALIZATION_CONFLICT")
		existing[key] = item.LogicalKey
	}
	var overrides []string
	outputs := make([]string, 0, 1+len(found.rows))
	outputs = append(outputs, file.LogicalKey)
	folded := map[string]bool{rules.Upper(file.LogicalKey): true}
	for _, row := range found.rows {
		target := prefix + row.name
		requireMolebox(rules.SafePath(target), "RUNTIME_MOLEBOX_PATH_INVALID")
		requireMolebox(rules.Upper(target) != rules.Upper(file.LogicalKey), "RUNTIME_NORMALIZATION_CONFLICT")
		// The supported node flags have no physical-file fallback; their paths shadow the external file.
		if previous, exists := existing[rules.Upper(target)]; exists {
			overrides = append(overrides, previous)
			row.logicalKey = previous
		} else {
			row.logicalKey = target
		}
		requireMolebox(!folded[rules.Upper(row.logicalKey)], "RUNTIME_NORMALIZATION_CONFLICT")
		folded[rules.Upper(row.logicalKey)] = true
		outputs = append(outputs, row.logicalKey)
	}
	domain := file.LogicalKey
	return &pipeline.Plan{
		Format: "molebox4-steelbox", Claims: []string{file.LogicalKey}, Outputs: outputs,
		Overrides: overrides, LaunchDomain: &domain, Data: &moleboxPlan{
			file: file, rows: found.rows,
			evidence: found.evidence,
		},
	}
}

type blockSource struct {
	ctx     context.Context
	handle  *content.Handle
	size    int64
	row     *moleboxRow
	index   int
	length  int64
	pending []byte
}

func (s *blockSource) Read(buffer []byte) (int, error) {
	for len(s.pending) == 0 {
		if s.index == len(s.row.blocks) {
			requireMolebox(s.length == s.row.sizeBytes)
			return 0, errEOF
		}
		block := s.row.blocks[s.index]
		s.index++
		data := readAt(s.ctx, s.handle, s.size, block.offset, int64(block.packed))
		if block.flags&4 != 0 {
			data = decodeMolebox(data, s.row.key, s.row.table, true)
		}
		if block.flags&2 != 0 {
			data = inflateMoleboxBlock(data, block.size)
		} else {
			data = data[:block.size]
		}
		requireMolebox(len(data) == block.size && moleboxCRC16(data) == block.crc16)
		s.length += int64(len(data))
		requireMolebox(s.length <= s.row.sizeBytes)
		s.pending = data
	}
	read := copy(buffer, s.pending)
	s.pending = s.pending[read:]
	return read, nil
}

func moleboxConvert(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	return guarded(func() (*pipeline.Result, error) { return moleboxConvertUnguarded(input, plan) })
}

func moleboxConvertUnguarded(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	data := as[*moleboxPlan](plan.Data)
	locator, err := input.Locator(data.file)
	if err != nil {
		return nil, fmt.Errorf("locator: %w", err)
	}
	verifySource(input.Ctx, locator, data.file.SHA256)
	first := writeDestination(input, data.file.LogicalKey, &locatedReader{ctx: input.Ctx, locator: locator})
	requireMolebox(first.SizeBytes == data.file.SizeBytes && first.SHA256 == data.file.SHA256, "RUNTIME_CONTENT_CHANGED")
	files := []pipeline.OutputFile{first}
	handle, err := content.Open(locator)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer func() { _ = handle.Close() }()
	blocks := 0
	for _, row := range data.rows {
		output := writeDestination(input, row.logicalKey,
			&blockSource{ctx: input.Ctx, handle: handle, size: int64(locator.SizeBytes), row: row})
		requireMolebox(int64(output.SizeBytes) == row.sizeBytes)
		files = append(files, output)
		blocks += len(row.blocks)
	}
	verifySource(input.Ctx, locator, data.file.SHA256)
	audit := map[string]any{
		"file": data.file.LogicalKey, "sourceSHA256": data.file.SHA256, "format": plan.Format,
		"extractedFiles": len(data.rows), "verifiedBlocks": blocks, "overrides": plan.Overrides, "nativeCodeExecuted": false,
	}
	for name, value := range data.evidence {
		audit[name] = value
	}
	writeAudit(input.AuditRoot, "molebox-"+rules.HashBytes([]byte(data.file.LogicalKey))+".json", audit)
	count := 1
	return &pipeline.Result{Files: files, Summary: &pipeline.Summary{
		ArchiveCount: &count, VerifiedEntries: len(data.rows),
		Details: []map[string]any{},
	}}, nil
}

func writeAudit(root, name string, value any) {
	requireMolebox(os.MkdirAll(root, 0o700) == nil, "RUNTIME_NORMALIZATION_OUTPUT_INVALID")
	encoded, err := json.MarshalIndent(value, "", "  ")
	requireMolebox(err == nil, "RUNTIME_NORMALIZATION_OUTPUT_INVALID")
	requireMolebox(os.WriteFile(filepath.Join(root, name), encoded, 0o600) == nil, "RUNTIME_NORMALIZATION_OUTPUT_INVALID")
}

// Molebox4 is the KiriKiri Molebox 4/STEELBOX container registration.
var Molebox4 = &pipeline.Plugin{
	ID: "molebox4-steelbox", Version: 1, Phase: "container", Priority: 100,
	Platforms: []string{"kirikiri"}, Formats: []string{"molebox4-steelbox"}, Probe: moleboxProbe, Convert: moleboxConvert,
}
