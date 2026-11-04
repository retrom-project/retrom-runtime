package normalize

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

func fileFact(file *rules.File) string {
	return `{"logicalKey":` + rules.JSONString(file.LogicalKey) + `,"sizeBytes":` +
		strconv.FormatInt(file.Size(), 10) + `,"sha256":` + rules.JSONString(file.SHA256) + `}`
}

func companionArchive(files []rules.File, root, name string) *rules.File {
	var candidates []*rules.File
	for index := range files {
		file := &files[index]
		if rules.Upper(path.Base(file.LogicalKey)) == rules.Upper(name) && rules.Root(file.LogicalKey) == root {
			candidates = append(candidates, file)
		}
	}
	requireXmoe(len(candidates) > 0, "RUNTIME_XMOE_ARCHIVE_MISSING")
	requireXmoe(len(candidates) == 1, "RUNTIME_NORMALIZATION_LAUNCH_AMBIGUOUS")
	return candidates[0]
}

func projectEntry(input *pipeline.Context) string {
	value, err := input.Cache.Load("xmoe-project-entry", func() (any, error) {
		evidence := map[string]rules.Evidence{}
		for index := range input.Files {
			file := &input.Files[index]
			checkCancel(input.Ctx)
			if file.SizeBytes < float64(len(rules.XP3Signature)) {
				continue
			}
			locator, err := input.Locator(file)
			if err != nil {
				return nil, fmt.Errorf("locator: %w", err)
			}
			prefix, err := content.ReadPrefix(input.Ctx, locator, int64(len(rules.XP3Signature)))
			if err != nil {
				return nil, fmt.Errorf("read prefix: %w", err)
			}
			encoded := base64.StdEncoding.EncodeToString(prefix)
			evidence[file.LogicalKey] = rules.Evidence{PrefixBase64: &encoded}
		}
		return rules.KirikiriEntry(input.Files, evidence, "")
	})
	if err != nil {
		panic(err)
	}
	return as[string](value)
}

type xmoePlan struct {
	module, archive *rules.File
	entryFile       string
	overlayRoot     string
	manifest        string
	profile         *xmoeProfile
	rows            []*xmoeEntry
}

type priorManifest struct {
	OverlayRoot string `json:"overlayRoot"`
	SourceFiles []struct {
		LogicalKey string  `json:"logicalKey"`
		SizeBytes  float64 `json:"sizeBytes"`
		SHA256     string  `json:"sha256"`
	} `json:"sourceFiles"`
}

// lists reports whether the manifest records exactly the given source facts.
func (m *priorManifest) lists(sources []*rules.File) bool {
	if len(m.SourceFiles) != len(sources) {
		return false
	}
	for _, source := range sources {
		found := false
		for _, item := range m.SourceFiles {
			found = found || item.LogicalKey == source.LogicalKey && item.SizeBytes == source.SizeBytes &&
				item.SHA256 == source.SHA256
		}
		if !found {
			return false
		}
	}
	return true
}

// readPriorManifest reads and validates the previous patch manifest as a KiriKiri resource patch.
func readPriorManifest(input *pipeline.Context, plan *xmoePlan, previous *rules.File) *priorManifest {
	requireXmoe(previous != nil && previous.SizeBytes <= 256*1024, "RUNTIME_NORMALIZATION_CONFLICT")
	locator, err := input.Locator(previous)
	if err != nil {
		panic(err)
	}
	data, err := content.ReadAll(input.Ctx, locator)
	if err != nil {
		panic(err)
	}
	requireXmoe(content.SHA256(data) == previous.SHA256, "RUNTIME_CONTENT_CHANGED")
	text, ok := textcodec.Decode(data, "utf-8", false)
	if !ok {
		panic(internalError("The encoded data was not valid for encoding utf-8"))
	}
	entry := plan.entryFile
	config := &rules.Configuration{Content: rules.Content{Kind: "KIRIKIRI_PROJECT", EntryFile: &entry}}
	if _, err := rules.KirikiriPatchLaunches(input.Files, map[string]rules.Evidence{plan.manifest: {Text: &text}},
		config); err != nil {
		panic(err)
	}
	manifest := &priorManifest{}
	if err := json.Unmarshal([]byte(text), manifest); err != nil {
		panic(internalError(err.Error()))
	}
	return manifest
}

// priorOutputs admits replacing a previous normalization of the same sources at the same overlay root.
func priorOutputs(input *pipeline.Context, plan *xmoePlan, outputs []string) []string {
	var reserved []*rules.File
	var previous *rules.File
	for index := range input.Files {
		file := &input.Files[index]
		if file.LogicalKey == plan.manifest || strings.HasPrefix(file.LogicalKey, plan.overlayRoot+"/") {
			reserved = append(reserved, file)
		}
		if file.LogicalKey == plan.manifest {
			previous = file
		}
	}
	if len(reserved) == 0 {
		return nil
	}
	manifest := readPriorManifest(input, plan, previous)
	requireXmoe(manifest.OverlayRoot == plan.overlayRoot && manifest.lists([]*rules.File{plan.module, plan.archive}),
		"RUNTIME_NORMALIZATION_CONFLICT")
	keys := make([]string, 0, len(reserved))
	for _, file := range reserved {
		requireXmoe(containsString(outputs, file.LogicalKey), "RUNTIME_NORMALIZATION_CONFLICT")
		keys = append(keys, file.LogicalKey)
	}
	return keys
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

type internalError string

func (e internalError) Error() string { return string(e) }

var nativeModule = regexp.MustCompile(`(?i)\.(?:exe|dll|tpm)$`)

func xmoeProbe(input *pipeline.Context) ([]*pipeline.Plan, error) {
	return guarded(func() ([]*pipeline.Plan, error) { return xmoeProbeUnguarded(input) })
}

func xmoeProbeUnguarded(input *pipeline.Context) ([]*pipeline.Plan, error) {
	var plans []*pipeline.Plan
	for index := range input.Files {
		module := &input.Files[index]
		checkCancel(input.Ctx)
		if !nativeModule.MatchString(module.LogicalKey) || module.SizeBytes < 64 || module.SizeBytes > xmoeImage {
			continue
		}
		locator, err := input.Locator(module)
		if err != nil {
			return nil, fmt.Errorf("locator: %w", err)
		}
		data, err := content.ReadAll(input.Ctx, locator)
		if err != nil {
			return nil, fmt.Errorf("read all: %w", err)
		}
		requireXmoe(content.SHA256(data) == module.SHA256, "RUNTIME_CONTENT_CHANGED")
		profile := probeXmoeCompanion(input.Ctx, data)
		if profile == nil {
			continue
		}
		plans = append(plans, xmoeModulePlan(input, module, profile))
	}
	return plans, nil
}

func xmoeModulePlan(input *pipeline.Context, module *rules.File, profile *xmoeProfile) *pipeline.Plan {
	entryFile := projectEntry(input)
	projectRoot := rules.Root(entryFile)
	requireXmoe(strings.HasPrefix(module.LogicalKey, projectRoot), "RUNTIME_NORMALIZATION_LAUNCH_AMBIGUOUS")
	archive := companionArchive(input.Files, projectRoot, profile.archiveName)
	locator, err := input.Locator(archive)
	if err != nil {
		panic(err)
	}
	rows := inspectCompanion(input, locator, archive, profile)
	relativeRoot := ".runtime-patches/" + path.Base(module.LogicalKey)
	overlayRoot := projectRoot + relativeRoot
	manifest := projectRoot + ".runtime-launches/" + path.Base(module.LogicalKey) + ".json"
	requireXmoe(len(rows) <= 10000 && rules.UTF16Length(relativeRoot) <= 240, "RUNTIME_XMOE_LIMIT")
	outputs := make([]string, 0, 3+len(rows))
	outputs = append(outputs, module.LogicalKey, archive.LogicalKey, manifest)
	for _, row := range rows {
		row.logicalKey = overlayRoot + "/" + row.name
		outputs = append(outputs, row.logicalKey)
	}
	folded := map[string]bool{}
	for _, item := range outputs {
		folded[rules.Upper(item)] = true
		requireXmoe(rules.SafePath(item), "RUNTIME_NORMALIZATION_CONFLICT")
	}
	requireXmoe(len(folded) == len(outputs), "RUNTIME_NORMALIZATION_CONFLICT")
	data := &xmoePlan{
		module: module, archive: archive, entryFile: entryFile, overlayRoot: overlayRoot, manifest: manifest,
		profile: profile, rows: rows,
	}
	domain := module.LogicalKey
	return &pipeline.Plan{
		Format: "xmoe-psb", Claims: []string{module.LogicalKey, archive.LogicalKey}, Outputs: outputs,
		LaunchDomain: &domain, Overrides: priorOutputs(input, data, outputs), Data: data,
	}
}

func inspectCompanion(input *pipeline.Context, locator *content.Locator, archive *rules.File,
	profile *xmoeProfile,
) []*xmoeEntry {
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	header := readExactXmoe(handle, 0, 24)
	meta := inspectXmoeHeader(header, profile, archive.Size())
	return inspectXmoeArchive(input.Ctx, header, readExactXmoe(handle, meta.offset, meta.packed), profile, archive.Size())
}

// readExactXmoe mirrors the KiriKiri exact-read helper used by this converter.
func readExactXmoe(handle *content.Handle, at, size int64) bytesView {
	if at < 0 || size < 0 || at > handle.Size() || size > handle.Size()-at {
		panic(rules.Fail("RUNTIME_KIRIKIRI_ARCHIVE_INVALID"))
	}
	data := make([]byte, size)
	if err := handle.ReadFull(data, at); err != nil {
		panic(rules.Fail("RUNTIME_KIRIKIRI_ARCHIVE_INVALID"))
	}
	return data
}

func xmoeConvert(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	return guarded(func() (*pipeline.Result, error) { return xmoeConvertUnguarded(input, plan) })
}

func xmoeConvertUnguarded(input *pipeline.Context, plan *pipeline.Plan) (*pipeline.Result, error) {
	data := as[*xmoePlan](plan.Data)
	sources := []*rules.File{data.module, data.archive}
	var files []pipeline.OutputFile
	for _, source := range sources {
		locator, err := input.Locator(source)
		if err != nil {
			return nil, fmt.Errorf("locator: %w", err)
		}
		verifySource(input.Ctx, locator, source.SHA256)
		copied := writeDestination(input, source.LogicalKey, &locatedReader{ctx: input.Ctx, locator: locator})
		requireXmoe(copied.SHA256 == source.SHA256 && copied.SizeBytes == source.SizeBytes, "RUNTIME_CONTENT_CHANGED")
		files = append(files, copied)
	}
	resources := decodeCompanion(input, data)
	files = append(files, resources...)
	facts := make([]string, len(resources))
	for index := range resources {
		facts[index] = fileFact(&resources[index].File)
	}
	manifest := []byte(`{"kind":"KIRIKIRI_RESOURCE_PATCH","version":1,"sourceFiles":[` + fileFact(data.module) + "," +
		fileFact(data.archive) + `],"overlayRoot":` + rules.JSONString(data.overlayRoot) + `,"resources":[` +
		strings.Join(facts, ",") + "]}")
	requireXmoe(len(manifest) <= 256*1024, "RUNTIME_XMOE_LIMIT")
	files = append(files, writeDestination(input, data.manifest, bytes.NewReader(manifest)))
	for _, source := range sources {
		locator, err := input.Locator(source)
		if err != nil {
			return nil, fmt.Errorf("locator: %w", err)
		}
		verifySource(input.Ctx, locator, source.SHA256)
	}
	audit := map[string]any{
		"format": plan.Format, "sources": []any{
			json.RawMessage(fileFact(data.module)),
			json.RawMessage(fileFact(data.archive)),
		}, "nativeProfile": data.profile.evidence, "resources": len(resources),
		"nativeCodeExecuted": false, "translationLanguageVerified": false,
	}
	writeAudit(input.AuditRoot, "xmoe-"+rules.HashBytes([]byte(data.module.LogicalKey))+".json", audit)
	count := 1
	return &pipeline.Result{Files: files, Summary: &pipeline.Summary{
		ArchiveCount: &count, VerifiedEntries: len(resources),
		Details: []map[string]any{{"code": "STATIC_RESOURCE_PATCH", "file": data.module.LogicalKey, "member": data.manifest}},
	}}, nil
}

func decodeCompanion(input *pipeline.Context, data *xmoePlan) []pipeline.OutputFile {
	locator, err := input.Locator(data.archive)
	if err != nil {
		panic(err)
	}
	handle, err := content.Open(locator)
	if err != nil {
		panic(err)
	}
	defer func() { _ = handle.Close() }()
	files := make([]pipeline.OutputFile, 0, len(data.rows))
	total := 0
	for _, row := range data.rows {
		checkCancel(input.Ctx)
		decoded := decodeXmoePayload(input.Ctx, readExactXmoe(handle, row.offset, row.packed), data.profile)
		total += len(decoded)
		requireXmoe(total <= xmoeTree, "RUNTIME_XMOE_LIMIT")
		files = append(files, writeDestination(input, row.logicalKey, bytes.NewReader(decoded)))
	}
	return files
}

// XmoeResourcePatch is the KiriKiri X'moe PSB static resource patch registration.
var XmoeResourcePatch = &pipeline.Plugin{
	ID: "xmoe-psb", Version: 1, Phase: "container", Priority: 110,
	Platforms: []string{"kirikiri"}, Formats: []string{"xmoe-psb"}, Probe: xmoeProbe, Convert: xmoeConvert,
}
