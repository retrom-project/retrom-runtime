package kirikiri

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

type hxArchive struct {
	file     *rules.File
	archive  *Archive
	payload  []byte
	flags    int
	records  []*hxRecord
	bindings map[*Entry]*hxRecord
}

func hxContainer(input *pipeline.Context, file *rules.File, locator *content.Locator) *hxArchive {
	handle, err := content.Open(locator)
	if err != nil {
		panic(asFailure(err))
	}
	defer func() { _ = handle.Close() }()
	rows := indexes(input.Ctx, handle, nil)
	var descriptors []row
	for _, item := range rows {
		require(item.tag == "Hxv4" || item.tag == "File")
		if item.tag == "Hxv4" {
			descriptors = append(descriptors, item)
		}
	}
	require(len(descriptors) == 1)
	descriptor := descriptors[0].data
	require(len(descriptor) == 14)
	offset, size, flags := number64(descriptor, 0), int64(descriptor.u32(8)), descriptor.u16(12)
	require(offset >= 19 && size >= 16 && size <= maximumIndex && flags&^1 == 0)
	payload := readExact(handle, offset, size)
	var entries []*Entry
	names := map[string]bool{}
	for _, item := range rows {
		if item.tag == "File" {
			entry := parseFile(item.data, int64(locator.SizeBytes), false)
			require(!names[entry.Physical])
			names[entry.Physical] = true
			entries = append(entries, entry)
		}
	}
	require(len(entries) > 0 && len(entries) <= 250000, "ARCHIVE_LIMIT")
	return &hxArchive{
		file: file, payload: payload, flags: flags, bindings: map[*Entry]*hxRecord{},
		archive: &Archive{Locator: locator, Entries: entries, Format: "hxv4-decoded"},
	}
}

func bootstrapProfiles(input *pipeline.Context) []*hxProfile {
	order := []string{}
	found := map[string]*hxProfile{}
	total, unsupported := 0.0, false
	for index := range input.Files {
		file := &input.Files[index]
		if input.Ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		if file.SizeBytes < 64 || file.SizeBytes > 64*1024*1024 {
			continue
		}
		locator, err := input.Locator(file)
		if err != nil {
			panic(err)
		}
		if !isMZ(locator) {
			continue
		}
		total += file.SizeBytes
		require(total <= 512*1024*1024, "MODULE_LIMIT")
		data, err := content.ReadPrefix(input.Ctx, locator, file.Size())
		if err != nil {
			panic(asFailure(err))
		}
		require(int64(len(data)) == file.Size() && digest(data) == file.SHA256, "SOURCE_CHANGED")
		profile, skipped := discoverProfile(data)
		if skipped {
			unsupported = true
			continue
		}
		if profile != nil {
			key := profile.bootstrapSHA256 + ":" + profile.startupSHA256
			if _, exists := found[key]; !exists {
				order = append(order, key)
			}
			found[key] = profile
			require(len(found) <= 16, "MODULE_LIMIT")
		}
	}
	require(len(found) > 0 || !unsupported, "HXV4_BOOTSTRAP_UNAVAILABLE")
	result := make([]*hxProfile, 0, len(order))
	for _, key := range order {
		result = append(result, found[key])
	}
	return result
}

func isMZ(locator *content.Locator) bool {
	handle, err := content.Open(locator)
	if err != nil {
		panic(asFailure(err))
	}
	defer func() { _ = handle.Close() }()
	return bytes.Equal(readExact(handle, 0, 2), []byte("MZ"))
}

// discoverProfile returns the bootstrap profile, or skipped when the module is a recognized unsupported shape.
func discoverProfile(data []byte) (*hxProfile, bool) {
	profile, err := guard(func() *hxProfile { return discoverHXBootstrap(data) })
	if err == nil {
		return profile, false
	}
	var failure *rules.Failure
	if errors.As(err, &failure) && (failure.Code == "RUNTIME_KIRIKIRI_HXV4_BOOTSTRAP_UNAVAILABLE" ||
		failure.Code == "RUNTIME_KIRIKIRI_HXV4_HASHER_UNSUPPORTED") {
		return nil, true
	}
	panic(err)
}

type decodedTable struct {
	archive     *hxArchive
	records     []*hxRecord
	tableSHA256 string
}

type accepted struct {
	material  *hxMaterial
	decoded   []decodedTable
	profile   *hxProfile
	mediaName string
}

func authenticate(input *pipeline.Context, profile *hxProfile, archives []*hxArchive) []*accepted {
	order := []string{}
	found := map[string]*accepted{}
	for _, prefix := range profile.prefixes {
		for _, seed := range profile.seeds {
			if input.Ctx.Err() != nil {
				panic(rules.Fail("RUNTIME_CANCELLED"))
			}
			material := deriveHXMaterial(profile.params, prefix, profile.warning, profile.unique, seed)
			decoded, ok := decodeTables(material, archives)
			if !ok {
				continue
			}
			var records []*hxRecord
			for _, item := range decoded {
				records = append(records, item.records...)
			}
			media := selectHXMedia(profile.strings, records)
			key := hex.EncodeToString(material.key) + ":" + hex.EncodeToString(material.nonce0) + ":" +
				hex.EncodeToString(material.nonce1)
			if _, exists := found[key]; !exists {
				order = append(order, key)
			}
			found[key] = &accepted{material: material, decoded: decoded, profile: profile, mediaName: media}
		}
	}
	result := make([]*accepted, 0, len(order))
	for _, key := range order {
		result = append(result, found[key])
	}
	return result
}

func decodeAll(material *hxMaterial, archives []*hxArchive) []decodedTable {
	decoded := make([]decodedTable, 0, len(archives))
	for _, archive := range archives {
		nonce := material.nonce0
		if archive.flags&1 != 0 {
			nonce = material.nonce1
		}
		table := decryptHXPayload(archive.payload, material.key, nonce)
		decoded = append(decoded, decodedTable{archive: archive, records: parseHXTable(table), tableSHA256: digest(table)})
	}
	return decoded
}

// decodeTables decrypts every namespace table; an authentication failure rejects only this key material.
func decodeTables(material *hxMaterial, archives []*hxArchive) ([]decodedTable, bool) {
	decoded, err := guard(func() []decodedTable { return decodeAll(material, archives) })
	if err == nil {
		return decoded, true
	}
	var failure *rules.Failure
	if errors.As(err, &failure) && failure.Code == "RUNTIME_KIRIKIRI_HXV4_AUTHENTICATION_FAILED" {
		return nil, false
	}
	panic(err)
}

const hxWarning = "Warning: Extracting this archive may infringe on author's rights."

func hxWarningMetadata(input *pipeline.Context, archive *Archive, entry *Entry, record *hxRecord) {
	if entry.Readable == entry.Size && entry.storedSize() == entry.Packed {
		return
	}
	require(record != nil && record.entryID == 0 && shortWarningShape(entry))
	data := readAll(input.Ctx, archive.Locator, entry)
	text, ok := textcodec.Decode(data, "shift_jis", false)
	require(ok && int64(len(data)) == entry.Readable && strings.HasPrefix(text, hxWarning))
	for _, character := range text {
		require(character >= 32 && character != 127 || strings.ContainsRune("\r\n\t", character))
	}
	entry.WarningMetadata = true
}

func bindRecords(input *pipeline.Context, decoded []decodedTable, mediaName string) {
	for _, item := range decoded {
		archive := item.archive
		ids, bound := map[uint32]int{}, map[uint32]bool{}
		for index, entry := range archive.archive.Entries {
			if id, ok := hxEntryID(entry.Physical); ok {
				_, duplicate := ids[id]
				require(!duplicate, "NAME_MAP_INVALID")
				ids[id] = index
			}
		}
		for _, record := range item.records {
			index, known := ids[record.entryID]
			require(record.archiveSlot == 0 && known && !bound[record.entryID], "NAME_MAP_INVALID")
			bound[record.entryID] = true
			record.fileIndex = index
			entry := archive.archive.Entries[index]
			archive.bindings[entry] = record
			hxWarningMetadata(input, archive.archive, entry, record)
		}
		require(len(bound) == len(ids), "NAME_MAP_INVALID")
		for _, entry := range archive.archive.Entries {
			if archive.bindings[entry] == nil {
				hxWarningMetadata(input, archive.archive, entry, nil)
			}
		}
		archive.records = item.records
		archive.archive.ExtraIndexChunks = [][]byte{chunkBytes("RHx4", encodeHXNamespace(mediaName, item.records))}
	}
}

func hxFilter(manager *hxManager, archives []*hxArchive) *Filter {
	states := map[*Entry]*hxState{}
	records := map[*Entry]*hxRecord{}
	for _, archive := range archives {
		for entry, record := range archive.bindings {
			records[entry] = record
		}
	}
	return &Filter{Kind: "hxv4", Verified: true, Apply: func(data []byte, _ uint32, offset int64, entry *Entry) {
		record := records[entry]
		if entry == nil || record == nil || entry.WarningMetadata {
			return
		}
		state := states[entry]
		if state == nil {
			state = manager.state(record.entryKey, record.localFlags)
			states[entry] = state
		}
		applyHXState(data, offset, state)
	}}
}

func verifyHXSamples(input *pipeline.Context, archives []*hxArchive, filter *Filter) {
	checksums := map[uint32]bool{}
	for _, archive := range archives {
		for _, entry := range archive.archive.Entries {
			if archive.bindings[entry] == nil || entry.WarningMetadata || entry.Readable != entry.Size || entry.Size < 32 ||
				entry.Size > 4*1024*1024 || checksums[entry.Adler] {
				continue
			}
			size, checksum := int64(0), uint32(1)
			resourceBytes(input.Ctx, archive.archive.Locator, entry, func(data []byte) {
				filter.Apply(data, 0, size, entry)
				size += int64(len(data))
				checksum = adler32(data, checksum)
			})
			require(size == entry.Size && checksum == entry.Adler, "CHECKSUM_MISMATCH")
			checksums[checksum] = true
			if len(checksums) == 3 {
				return
			}
		}
	}
	panic(fail("FILTER_UNAVAILABLE"))
}

type hxPlan struct {
	archives []*hxArchive
	filter   *Filter
	selected *accepted
}

type pendingArchive struct {
	file    *rules.File
	locator *content.Locator
}

func pendingHXV4(input *pipeline.Context) []pendingArchive {
	var waiting []pendingArchive
	for index := range input.Files {
		file := &input.Files[index]
		locator, err := input.Locator(file)
		if err != nil {
			panic(err)
		}
		if archive := cachedXP3(input, file); archive != nil && archive.Unsupported == "hxv4" {
			waiting = append(waiting, pendingArchive{file, locator})
		}
	}
	return waiting
}

func hxPlans(input *pipeline.Context) []*pipeline.Plan {
	waiting := pendingHXV4(input)
	if len(waiting) == 0 {
		return nil
	}
	profiles := bootstrapProfiles(input)
	if len(profiles) == 0 {
		return nil
	}
	archives := make([]*hxArchive, len(waiting))
	claims := make([]string, len(waiting))
	for index, item := range waiting {
		archives[index], claims[index] = hxContainer(input, item.file, item.locator), item.file.LogicalKey
	}
	var all []*accepted
	for _, profile := range profiles {
		all = append(all, authenticate(input, profile, archives)...)
	}
	require(len(all) > 0, "HXV4_BOOTSTRAP_UNAVAILABLE")
	require(len(all) == 1, "FILTER_AMBIGUOUS")
	selected := all[0]
	bindRecords(input, selected.decoded, selected.mediaName)
	filter := hxFilter(createHXManager(selected.material), archives)
	verifyHXSamples(input, archives, filter)
	return []*pipeline.Plan{{
		Format: "hxv4-decoded", Claims: claims, Outputs: claims,
		Data: &hxPlan{archives: archives, filter: filter, selected: selected},
	}}
}

func hxProbe(input *pipeline.Context) ([]*pipeline.Plan, error) {
	return guard(func() []*pipeline.Plan { return hxPlans(input) })
}

func hxRecorder(log *audit, summary *pipeline.Summary) Auditor {
	return func(row AuditRow) {
		log.write(row)
		if codes, _ := row["corrections"].([]string); len(codes) > 0 {
			summary.Details = append(summary.Details, map[string]any{
				"code": codes[0], "file": row["archive"],
				"member": row["physicalName"], "sourceSha256": row["rawStreamSha256"], "outputSha256": row["outputSha256"],
				"sourceSize": row["sourceSize"], "outputSize": row["outputSize"],
			})
		}
	}
}

func hxConvertArchives(input *pipeline.Context, data *hxPlan) *pipeline.Result {
	log, directory := newAudit(input.OutputRoot)
	defer log.close()
	count := len(data.archives)
	summary := &pipeline.Summary{ArchiveCount: &count, Warnings: []pipeline.Warning{}, Details: []map[string]any{}}
	total := inputTotal(input.Files)
	record := hxRecorder(log, summary)
	files := make([]pipeline.OutputFile, 0, len(data.archives))
	for _, archive := range data.archives {
		path := filepath.Join(input.OutputRoot, archive.file.LogicalKey)
		require(os.MkdirAll(filepath.Dir(path), 0o700) == nil)
		converted := ConvertXP3(input.Ctx, archive.archive, archive.file, path, data.filter, record)
		output := pipeline.OutputFile{File: *archive.file, Path: path}
		output.SizeBytes, output.SHA256 = float64(converted.SizeBytes), converted.SHA256
		files = append(files, output)
		total += converted.SizeBytes - archive.file.Size()
		require(total <= MaximumTree, "ARCHIVE_LIMIT")
		summary.VerifiedEntries += converted.VerifiedEntries
		summary.MetadataCorrections += converted.MetadataCorrections
		log.write(AuditRow{
			"kind": "hxv4-namespace", "archive": archive.file.LogicalKey, "sourceSha256": archive.file.SHA256,
			"outputSha256": converted.SHA256, "payloadSha256": digest(archive.payload),
			"mediaName": data.selected.mediaName, "namespaceSha256": digest(archive.archive.ExtraIndexChunks[0]),
			"descriptorFlags": archive.flags, "sourceModuleSha256": data.selected.profile.sourceModuleSHA256,
			"bootstrapSha256": data.selected.profile.bootstrapSHA256, "records": len(archive.records),
		})
	}
	summarizeWarnings(summary)
	encoded, err := json.Marshal(summary)
	require(err == nil && os.WriteFile(filepath.Join(directory, "summary.json"), append(encoded, '\n'), 0o600) == nil)
	return &pipeline.Result{Files: files, Summary: summary}
}

func hxConvert(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	data, ok := plan.Data.(*hxPlan)
	if !ok {
		return nil, fail("ARCHIVE_INVALID")
	}
	return guard(func() *pipeline.Result { return hxConvertArchives(input, data) })
}

// HXV4 is the KiriKiri Hxv4 resource-phase registration.
var HXV4 = &pipeline.Plugin{
	ID: "kirikiri-hxv4", Phase: "resource", Version: 1, Priority: 110,
	Platforms: []string{"kirikiri"}, Formats: []string{"hxv4-decoded"}, Probe: hxProbe, Convert: hxConvert,
}
