package kirikiri

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

type candidate struct {
	kind         string
	classic      *ClassicProfile
	tiny         *TinyProfile
	configured   *ConfiguredProfile
	rolling      *RollingProfile
	moduleSHA256 string
}

func (c *candidate) legacyBulk() bool { return c.classic != nil && c.classic.LegacyBulk }

func (c *candidate) key() string {
	switch c.kind {
	case "rolling-xor":
		constant := uint32(0)
		if c.rolling.XORConstant != nil {
			constant = *c.rolling.XORConstant
		}
		return fmt.Sprintf("rolling-xor:%d:%s", constant, digest(c.rolling.Table))
	case "configured":
		return "configured:" + digest(c.configured.Params) + ":" + digest(c.configured.ControlBlock)
	case "tiny":
		value := c.tiny.XORConstant
		first := "none"
		if c.tiny.FirstByte {
			first = fmt.Sprintf("%d:%d", value&255, c.tiny.FirstZeroFallback)
		}
		return fmt.Sprintf("tiny:%d:%d:%s", (value^value>>8^value>>16^value>>24)&255, c.tiny.ZeroFallback, first)
	default:
		p := c.classic
		return fmt.Sprintf("classic:%d:%d:%s:%s:%s:%s", p.Mask, p.Offset, orderKey(p.PrologOrder),
			orderKey(p.EvenBranchOrder), orderKey(p.OddBranchOrder), digest(p.ControlBlock))
	}
}

var nativeExtension = regexp.MustCompile(`(?i)\.(?:exe|dll|tpm)$`)

type nativeInspector struct {
	order    []string
	profiles map[string]*candidate
	visited  map[string]bool
	total    int
	modules  int
}

func (n *nativeInspector) inspect(data []byte, depth int) {
	sha := digest(data)
	if n.visited[sha] {
		return
	}
	n.visited[sha] = true
	n.total += len(data)
	n.modules++
	require(depth <= 3 && n.modules <= 512 && n.total <= 512*1024*1024, "MODULE_LIMIT")
	var found []*candidate
	for _, profile := range discoverCxProfiles(data) {
		found = append(found, &candidate{kind: "classic", classic: profile})
	}
	for _, profile := range discoverTinyProfiles(data) {
		found = append(found, &candidate{kind: "tiny", tiny: profile})
	}
	for _, profile := range discoverConfiguredProfiles(data) {
		found = append(found, &candidate{kind: "configured", configured: profile})
	}
	for _, profile := range discoverRollingProfiles(data) {
		found = append(found, &candidate{kind: "rolling-xor", rolling: profile})
	}
	for _, value := range found {
		key := value.key()
		previous, exists := n.profiles[key]
		if !exists || !previous.legacyBulk() || value.legacyBulk() {
			if !exists {
				n.order = append(n.order, key)
			}
			value.moduleSHA256 = sha
			n.profiles[key] = value
		}
	}
	require(len(n.profiles) <= 64, "FILTER_AMBIGUOUS")
	for _, embedded := range extractEmbeddedPEModules(data, 512*1024*1024-n.total) {
		n.inspect(embedded, depth+1)
	}
}

type archiveFile struct {
	file     *rules.File
	archive  *Archive
	embedded bool
}

func checkCancel(ctx context.Context) {
	if ctx.Err() != nil {
		panic(rules.Fail("RUNTIME_CANCELLED"))
	}
}

// inspectSources inspects every native module of a view once per content digest.
func (n *nativeInspector) inspectSources(input *pipeline.Context, view *pipeline.Sources, sources map[string]bool) {
	for index := range view.Files {
		file := &view.Files[index]
		checkCancel(input.Ctx)
		if !nativeExtension.MatchString(file.LogicalKey) || file.SizeBytes == 0 {
			continue
		}
		locator, err := view.Locator(file)
		if err != nil {
			panic(err)
		}
		require(sourceHash(input.Ctx, locator) == file.SHA256, "SOURCE_CHANGED")
		if sources[file.SHA256] {
			continue
		}
		sources[file.SHA256] = true
		if data := nativeModule(locator); data != nil {
			n.inspect(data, 0)
		}
	}
}

func (n *nativeInspector) inspectArchive(input *pipeline.Context, item archiveFile) {
	require(sourceHash(input.Ctx, item.archive.source()) == item.file.SHA256, "SOURCE_CHANGED")
	for _, entry := range item.archive.Entries {
		checkCancel(input.Ctx)
		if !nativeExtension.MatchString(entry.Name) || entry.Flags != 0 || entry.Size == 0 {
			continue
		}
		require(entry.Size <= 64*1024*1024, "MODULE_LIMIT")
		n.inspect(readAll(input.Ctx, item.archive.Locator, entry), 1)
	}
}

func nativeProfiles(input *pipeline.Context, archives []archiveFile) []*candidate {
	inspector := &nativeInspector{profiles: map[string]*candidate{}, visited: map[string]bool{}}
	sources := map[string]bool{}
	// An embedded wrapper can replace a module without changing the archive's filter; originals remain evidence.
	inspector.inspectSources(input, &input.Sources, sources)
	inspector.inspectSources(input, &input.Original, sources)
	for _, item := range archives {
		inspector.inspectArchive(input, item)
	}
	result := make([]*candidate, 0, len(inspector.order))
	for _, key := range inspector.order {
		result = append(result, inspector.profiles[key])
	}
	return result
}

type sample struct {
	h, adler uint32
	data     []byte
}

func allNative(archives []*Archive) bool {
	for _, archive := range archives {
		if archive.Format != "xp3-native" {
			return false
		}
	}
	return true
}

func sampleable(archive *Archive, entry *Entry, seeds map[uint32]bool) bool {
	return entry.Size >= 32 && entry.Size <= 4*1024*1024 && entry.Size == entry.Readable && !entry.ReusedSeed &&
		!entry.SeedOnly && !seeds[entry.H] && (archive.Format != "xp3-native" || entry.Flags == 0x80000000)
}

func samples(input *pipeline.Context, archives []*Archive) []sample {
	var result []sample
	seeds := map[uint32]bool{}
	limit := 8
	if allNative(archives) {
		limit = 32
	}
	for _, archive := range archives {
		count := 0
		for _, entry := range archive.Entries {
			if !sampleable(archive, entry, seeds) {
				continue
			}
			result = append(result, sample{h: entry.H, adler: entry.Adler, data: readAll(input.Ctx, archive.Locator, entry)})
			seeds[entry.H] = true
			if len(result) == limit {
				return result
			}
			if count++; count == 8 {
				break
			}
		}
	}
	return result
}

func buildFilter(value *candidate, archives []*Archive) *Filter {
	var filter *Filter
	switch value.kind {
	case "tiny":
		filter = &Filter{Kind: "tiny", Profile: value.tiny, Apply: wrap(createTinyFilter(value.tiny))}
	case "configured":
		filter = &Filter{Kind: "configured", Profile: value.configured, Apply: wrap(createConfiguredFilter(value.configured))}
	case "rolling-xor":
		filter = &Filter{Kind: "rolling-xor", Profile: value.rolling, Apply: wrap(createRollingFilter(value.rolling))}
	default:
		classic := createCxFilter(value.classic)
		filter = &Filter{Kind: "classic", Profile: value.classic, Apply: wrap(classic.apply)}
		if value.classic.LegacyBulk && allNative(archives) {
			filter.Stages = []Stage{{ID: "classic", Apply: classic.apply}, {ID: "legacy-bulk", Apply: classic.applyBulk}}
		}
	}
	filter.ModuleSHA256 = value.moduleSHA256
	return filter
}

// createFilter skips a candidate whose profile cannot construct a filter.
func createFilter(value *candidate, archives []*Archive) *Filter {
	filter, err := guard(func() *Filter { return buildFilter(value, archives) })
	if err != nil {
		return nil
	}
	return filter
}

func wrap(apply func([]byte, uint32, int64)) func([]byte, uint32, int64, *Entry) {
	return func(data []byte, seed uint32, offset int64, _ *Entry) { apply(data, seed, offset) }
}

func matchedProbes(filter *Filter, probes []sample) int {
	matched := 0
	for _, probe := range probes {
		if filter.Stages != nil {
			if probeStage(filter, probe.data, probe.h, probe.adler) {
				matched++
			}
			continue
		}
		decoded := append([]byte(nil), probe.data...)
		filter.Apply(decoded, probe.h, 0, nil)
		if adler32(decoded, 1) == probe.adler {
			matched++
		}
	}
	return matched
}

func selectFilter(input *pipeline.Context, profiles []*candidate, archives []*Archive) *Filter {
	probes := samples(input, archives)
	ordinary := allNative(archives)
	require(len(probes) > 0, "FILTER_UNAVAILABLE")
	var accepted []*Filter
	for _, value := range profiles {
		checkCancel(input.Ctx)
		filter := createFilter(value, archives)
		if filter == nil {
			continue
		}
		matched := matchedProbes(filter, probes)
		// Ordinary archives are checked in full later; a seed-only archive requires three real checksum matches.
		if ordinary && matched >= 3 || !ordinary && matched == len(probes) {
			filter.Verified = matched >= 3
			accepted = append(accepted, filter)
		}
	}
	require(len(accepted) > 0, "FILTER_UNAVAILABLE")
	require(len(accepted) == 1, "FILTER_AMBIGUOUS")
	return accepted[0]
}

func seedMaskMatches(probes []sample, mask byte) bool {
	for _, probe := range probes {
		decoded := append([]byte(nil), probe.data...)
		key := byte(probe.h&255) ^ mask
		for index := range decoded {
			decoded[index] ^= key
		}
		if adler32(decoded, 1) != probe.adler {
			return false
		}
	}
	return true
}

// seedXorFilter: distinct low bytes distinguish this resource-dependent family from a constant XOR.
func seedXorFilter(input *pipeline.Context, archives []*Archive) *Filter {
	probes := samples(input, archives)
	low := map[uint32]bool{}
	for _, probe := range probes {
		low[probe.h&255] = true
	}
	if len(probes) < 3 || len(low) < 2 {
		return nil
	}
	var found []int
	for mask := range 256 {
		checkCancel(input.Ctx)
		if seedMaskMatches(probes, byte(mask)) {
			found = append(found, mask)
		}
	}
	if len(found) != 1 {
		return nil
	}
	mask := byte(found[0])
	return &Filter{
		Kind: "seed-xor", Verified: true, Profile: map[string]any{"mask": found[0]},
		Apply: func(data []byte, seed uint32, _ int64, _ *Entry) {
			key := byte(seed&255) ^ mask
			for index := range data {
				data[index] ^= key
			}
		},
	}
}

// probePlan carries the archives and filter of one plan.
type probePlan struct {
	archives []archiveFile
	filter   *Filter
}

func identityFilter() *Filter {
	return &Filter{
		Kind: "identity", Verified: true, Profile: map[string]any{},
		Apply: func([]byte, uint32, int64, *Entry) {},
	}
}

type archiveGroup struct {
	key   string
	items []archiveFile
}

// prober collects one whole-game probe: per-archive plans, CxFilterFS groups and native archives.
type prober struct {
	input  *pipeline.Context
	plans  []*pipeline.Plan
	groups []*archiveGroup
	byKey  map[string]*archiveGroup
	native []archiveFile
}

func (p *prober) add(file *rules.File, archive *Archive, filter *Filter, format string) {
	p.plans = append(p.plans, &pipeline.Plan{
		Format: format, Claims: []string{file.LogicalKey}, Outputs: []string{file.LogicalKey},
		Data: &probePlan{archives: []archiveFile{{file: file, archive: archive}}, filter: filter},
	})
}

func (p *prober) group(file *rules.File, archive *Archive) {
	key := archive.Format + "\x00" + archive.Salt
	if p.byKey[key] == nil {
		p.byKey[key] = &archiveGroup{key: key}
		p.groups = append(p.groups, p.byKey[key])
	}
	p.byKey[key].items = append(p.byKey[key].items, archiveFile{file: file, archive: archive})
}

func (p *prober) profiles() []*candidate {
	value, err := p.input.Cache.Load("cxfilterfs:profiles", func() (any, error) {
		return guard(func() []*candidate { return nativeProfiles(p.input, p.native) })
	})
	if err != nil {
		panic(err)
	}
	profiles, ok := value.([]*candidate)
	require(ok)
	return profiles
}

func (p *prober) groupPlans(profiles []*candidate) {
	for _, value := range p.groups {
		archives := make([]*Archive, len(value.items))
		claims := make([]string, len(value.items))
		for index, item := range value.items {
			archives[index], claims[index] = item.archive, item.file.LogicalKey
		}
		filter := selectFilter(p.input, profiles, archives)
		p.plans = append(p.plans, &pipeline.Plan{
			Format: value.items[0].archive.Format, Claims: claims, Outputs: claims,
			Data: &probePlan{archives: value.items, filter: filter},
		})
	}
}

func (p *prober) run() []*pipeline.Plan {
	for index := range p.input.Files {
		file := &p.input.Files[index]
		checkCancel(p.input.Ctx)
		require(rules.SafePath(file.LogicalKey))
		archive := cachedXP3(p.input, file)
		if archive == nil || archive.Format == "" {
			p.probePlain(file, archive)
			continue
		}
		p.group(file, archive)
	}
	if len(p.groups) == 0 && len(p.plans) == 0 && len(p.native) == 0 {
		return nil
	}
	for _, file := range p.input.Files {
		require(!filterScript.MatchString(file.LogicalKey), "ARCHIVE_UNSUPPORTED")
	}
	if len(p.groups) == 0 && len(p.native) == 0 {
		return p.plans
	}
	profiles := p.profiles()
	p.groupPlans(profiles)
	p.nativePlans(profiles)
	return p.plans
}

// probe produces one plan per related archive group for the whole game.
func probe(input *pipeline.Context) ([]*pipeline.Plan, error) {
	return guard(func() []*pipeline.Plan {
		return (&prober{input: input, byKey: map[string]*archiveGroup{}}).run()
	})
}

func cachedXP3(input *pipeline.Context, file *rules.File) *Archive {
	value, err := input.Cache.Load("xp3:"+file.LogicalKey, func() (any, error) {
		locator, err := input.Locator(file)
		if err != nil {
			return nil, fmt.Errorf("xp3 locator: %w", err)
		}
		return ReadXP3(input.Ctx, locator, ReadOptions{})
	})
	if err != nil {
		panic(err)
	}
	archive, _ := value.(*Archive)
	return archive
}

func plainFlags(plain *Archive) (bool, bool) {
	seedOnly := len(plain.Entries) > 1
	for _, entry := range plain.Entries {
		seedOnly = seedOnly && entry.Flags == 0 && entry.Adler == 0
	}
	correction, protected := false, false
	for _, entry := range plain.Entries {
		entry.SeedOnly = seedOnly
		correction = correction || entry.InfoCorrection != nil
		protected = protected || entry.Flags == 0x80000000 || entry.SeedOnly
	}
	return correction, protected
}

func (p *prober) probePlain(file *rules.File, archive *Archive) {
	locator, err := p.input.Locator(file)
	if err != nil {
		panic(err)
	}
	var embedded *Archive
	if archive == nil {
		embedded = peXP3(p.input.Ctx, locator)
	}
	plain := embedded
	if plain == nil && archive != nil && archive.Unsupported == "" {
		plain = ordinaryArchive(p.input.Ctx, locator)
	}
	if plain == nil {
		return
	}
	correction, protected := plainFlags(plain)
	format := func(fallback string) string {
		if embedded != nil {
			return "xp3-pe"
		}
		return fallback
	}
	fixed := fixedXorArchive(p.input.Ctx, plain)
	plaintext := fixed != nil && fixed.plaintext
	switch {
	case fixed != nil && !plaintext:
		p.add(file, fixed.archive, fixed.filter, format(fixed.archive.Format))
	case !plaintext && protected:
		nativeArchive := plain.clone()
		nativeArchive.Format = "xp3-native"
		p.native = append(p.native, archiveFile{file: file, archive: nativeArchive, embedded: embedded != nil})
	case embedded != nil || correction:
		p.add(file, plain, identityFilter(), format("xp3-native"))
	}
}

// selectNativeFilter falls back to the seed-XOR family only when no module profile authenticates.
func selectNativeFilter(input *pipeline.Context, profiles []*candidate, archives []*Archive) *Filter {
	if len(profiles) == 0 {
		return seedXorFilter(input, archives)
	}
	filter, err := guard(func() *Filter { return selectFilter(input, profiles, archives) })
	if err == nil {
		return filter
	}
	var failure *rules.Failure
	if !errors.As(err, &failure) || failure.Code != "RUNTIME_KIRIKIRI_FILTER_UNAVAILABLE" {
		panic(err)
	}
	if filter = seedXorFilter(input, archives); filter == nil {
		panic(err)
	}
	return filter
}

func (p *prober) nativePlans(profiles []*candidate) {
	if len(p.native) == 0 {
		return
	}
	archives := make([]*Archive, len(p.native))
	embedded := false
	for index, item := range p.native {
		archives[index] = item.archive
		embedded = embedded || item.embedded
	}
	filter := selectNativeFilter(p.input, profiles, archives)
	if filter == nil {
		require(!embedded, "FILTER_UNAVAILABLE")
		return
	}
	require(filter.Verified, "FILTER_UNAVAILABLE")
	apply := filter.Apply
	ordinary := *filter
	ordinary.Apply = func(data []byte, seed uint32, offset int64, entry *Entry) {
		if entry == nil || entry.Flags == 0x80000000 || entry.SeedOnly {
			apply(data, seed, offset, entry)
		}
	}
	for _, item := range p.native {
		format := "xp3-native"
		if item.embedded {
			format = "xp3-pe"
		}
		p.add(item.file, seedMetadataArchive(p.input.Ctx, item.archive, &ordinary), &ordinary, format)
	}
}

// audit writes temporary detailed conversion audit records, never game files.
type audit struct {
	file        *os.File
	buffer      *bufio.Writer
	details     []map[string]any
	detailBytes int
}

func newAudit(root string) (*audit, string) {
	directory, err := os.MkdirTemp(root, ".audit-")
	require(err == nil)
	file, err := os.OpenFile(filepath.Join(directory, "entries.jsonl"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	require(err == nil)
	return &audit{file: file, buffer: bufio.NewWriter(file), details: []map[string]any{}}, directory
}

func (a *audit) write(row AuditRow) {
	encoded, err := json.Marshal(row)
	require(err == nil)
	_, err = a.buffer.Write(append(encoded, '\n'))
	require(err == nil)
}

func (a *audit) close() {
	_ = a.buffer.Flush()
	_ = a.file.Sync()
	_ = a.file.Close()
}

func (a *audit) record(row AuditRow) {
	a.write(row)
	codes, _ := row["corrections"].([]string)
	if codes == nil && row["kind"] == "physical-only" {
		codes = []string{"OUTSIDE_LOGICAL_NAMESPACE"}
	}
	for _, code := range codes {
		member := row["logicalName"]
		if member == nil {
			member = row["physicalName"]
		}
		outputSize := row["outputSize"]
		if outputSize == nil {
			outputSize = row["readableSize"]
		}
		detail := map[string]any{
			"code": code, "file": row["archive"], "member": member,
			"sourceSha256": row["rawStreamSha256"], "outputSha256": row["outputSha256"], "sourceSize": row["sourceSize"],
			"outputSize": outputSize, "seed": row["sourceSeed"], "sourceChecksum": row["sourceAdler32"],
			"outputChecksum": row["outputAdler32"],
		}
		if correction, ok := row["infoSizeCorrection"].(*InfoCorrection); ok {
			detail["sourceInfoChunkSize"], detail["outputInfoChunkSize"] = correction.Declared, correction.Actual
		}
		encoded, _ := json.Marshal(detail)
		a.detailBytes += len(encoded)
		require(len(a.details) < 2048 && a.detailBytes <= 4*1024*1024-65536, "AUDIT_LIMIT")
		a.details = append(a.details, detail)
	}
}

// summarizeWarnings records the aggregated correction and namespace warnings.
func summarizeWarnings(summary *pipeline.Summary) {
	if summary.MetadataCorrections > 0 {
		summary.Warnings = append(summary.Warnings,
			pipeline.Warning{Code: "SOURCE_METADATA_CORRECTED", Count: summary.MetadataCorrections})
	}
	if summary.OmittedPhysicalEntries > 0 {
		summary.Warnings = append(summary.Warnings,
			pipeline.Warning{Code: "OUTSIDE_LOGICAL_NAMESPACE", Count: summary.OmittedPhysicalEntries})
	}
}

func inputTotal(files []rules.File) int64 {
	total := int64(0)
	for _, file := range files {
		total += file.Size()
	}
	return total
}

func convertArchives(input *pipeline.Context, data *probePlan) *pipeline.Result {
	log, directory := newAudit(input.AuditRoot)
	defer log.close()
	count := len(data.archives)
	summary := &pipeline.Summary{ArchiveCount: &count, Warnings: []pipeline.Warning{}}
	total := inputTotal(input.Files)
	files := make([]pipeline.OutputFile, 0, len(data.archives))
	for _, item := range data.archives {
		path := filepath.Join(input.OutputRoot, item.file.LogicalKey)
		require(os.MkdirAll(filepath.Dir(path), 0o700) == nil)
		converted := ConvertXP3(input.Ctx, item.archive, item.file, path, data.filter, log.record)
		total += converted.SizeBytes - item.file.Size()
		require(total <= MaximumTree, "ARCHIVE_LIMIT")
		output := pipeline.OutputFile{File: *item.file, Path: path}
		output.SizeBytes, output.SHA256 = float64(converted.SizeBytes), converted.SHA256
		files = append(files, output)
		summary.VerifiedEntries += converted.VerifiedEntries
		summary.MetadataCorrections += converted.MetadataCorrections
		summary.OmittedPhysicalEntries += converted.OmittedPhysicalEntry
		log.record(AuditRow{
			"archive": item.file.LogicalKey, "kind": "archive", "format": item.archive.Format,
			"sourceSha256": item.file.SHA256, "sourceSize": item.file.SizeBytes, "outputSha256": converted.SHA256,
			"outputSize": converted.SizeBytes, "filterKind": data.filter.Kind, "moduleSha256": data.filter.ModuleSHA256,
		})
	}
	summarizeWarnings(summary)
	summary.Details = log.details
	encoded, err := json.Marshal(summary)
	require(err == nil && os.WriteFile(filepath.Join(directory, "summary.json"), append(encoded, '\n'), 0o600) == nil)
	return &pipeline.Result{Files: files, Summary: summary}
}

// convert writes resources only; the common pipeline validates and packages once.
func convert(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	data, ok := plan.Data.(*probePlan)
	if !ok {
		return nil, fail("ARCHIVE_INVALID")
	}
	return guard(func() *pipeline.Result { return convertArchives(input, data) })
}

// CxFilterFS is the KiriKiri resource-phase registration.
var CxFilterFS = &pipeline.Plugin{
	ID: "kirikiri-cxfilterfs", Phase: "resource", Version: 1, Priority: 100,
	Platforms: []string{"kirikiri"}, Formats: []string{
		"cxfilterfs-elif", "cxfilterfs-hnfn", "cxfilterfs-yuzu",
		"cxfilterfs-neko", "cxfilterfs-sen", "xp3-fixed-xor", "xp3-pe", "xp3-native",
	}, Probe: probe, Convert: convert,
}
