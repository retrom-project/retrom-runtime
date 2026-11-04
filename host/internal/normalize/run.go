// Package normalize is the host-only content-normalization pipeline and its container plugins.
package normalize

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"os"
	"path/filepath"
	"regexp"
	"sort"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/kirikiri"
	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

const (
	maximumFile = 8 * 1024 * 1024 * 1024
	maximumTree = 64 * 1024 * 1024 * 1024
)

// Registry is the complete explicit registration list; adding a format requires only a plugin and this entry.
var Registry = []*pipeline.Plugin{
	Molebox4, EnigmaProtector, XmoeResourcePatch, kirikiri.CxFilterFS, kirikiri.HXV4,
	ElectronAsar, NWEmbeddedZIP,
}

// Supports reports whether any plugin is registered for a platform.
func Supports(platformID string) bool {
	for _, plugin := range Registry {
		if containsString(plugin.Platforms, platformID) {
			return true
		}
	}
	return false
}

var code = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func outputInvalid(value bool, name ...string) {
	if !value {
		failure := "RUNTIME_NORMALIZATION_OUTPUT_INVALID"
		if len(name) > 0 {
			failure = name[0]
		}
		panic(rules.Fail(failure))
	}
}

func registry(plugins []*pipeline.Plugin, platformID string) []*pipeline.Plugin {
	ids := map[string]bool{}
	var selected []*pipeline.Plugin
	for _, plugin := range plugins {
		valid := code.MatchString(plugin.ID) && !ids[plugin.ID] && plugin.Version > 0 &&
			(plugin.Phase == "container" || plugin.Phase == "resource") && len(plugin.Formats) > 0 &&
			plugin.Probe != nil && plugin.Convert != nil
		for _, item := range append(append([]string(nil), plugin.Platforms...), plugin.Formats...) {
			valid = valid && code.MatchString(item)
		}
		outputInvalid(valid, "RUNTIME_NORMALIZATION_REGISTRY_INVALID")
		ids[plugin.ID] = true
		if containsString(plugin.Platforms, platformID) {
			selected = append(selected, plugin)
		}
	}
	sort.SliceStable(selected, func(i, j int) bool {
		if selected[i].Priority != selected[j].Priority {
			return selected[i].Priority < selected[j].Priority
		}
		return selected[i].ID < selected[j].ID
	})
	return selected
}

type planned struct {
	plugin *pipeline.Plugin
	plan   *pipeline.Plan
}

func allIn(values []string, set map[string]bool) bool {
	for _, value := range values {
		if !set[value] {
			return false
		}
	}
	return true
}

func allSafe(values []string) bool {
	for _, value := range values {
		if !rules.SafePath(value) {
			return false
		}
	}
	return true
}

// validOverrides: an override replaces existing content in place and is output but never claimed.
func validOverrides(plugin *pipeline.Plugin, plan *pipeline.Plan, files, claims, outputs map[string]bool) bool {
	if len(uniqueSet(plan.Overrides)) != len(plan.Overrides) || len(plan.Overrides) != 0 && plugin.Phase != "container" {
		return false
	}
	for _, key := range plan.Overrides {
		if !files[key] || !outputs[key] || claims[key] {
			return false
		}
	}
	return true
}

func validPlan(plugin *pipeline.Plugin, plan *pipeline.Plan, files map[string]bool) bool {
	claims, outputs := uniqueSet(plan.Claims), uniqueSet(plan.Outputs)
	if !containsString(plugin.Formats, plan.Format) || len(plan.Claims) == 0 || len(claims) != len(plan.Claims) ||
		!allIn(plan.Claims, files) {
		return false
	}
	if len(plan.Outputs) == 0 || len(plan.Outputs) > 100000 || len(outputs) != len(plan.Outputs) ||
		!allSafe(plan.Outputs) {
		return false
	}
	if !validOverrides(plugin, plan, files, claims, outputs) {
		return false
	}
	return plan.LaunchDomain == nil || plugin.Phase == "container" && claims[*plan.LaunchDomain]
}

func uniqueSet(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

type phasePlans struct {
	plans            []planned
	files            map[string]bool
	claimed, domains map[string]bool
}

// add validates one plan and records its claims and overrides; overlapping claims conflict.
func (p *phasePlans) add(plugin *pipeline.Plugin, plan *pipeline.Plan) error {
	if !validPlan(plugin, plan, p.files) {
		return rules.Fail("RUNTIME_NORMALIZATION_PLAN_INVALID")
	}
	if plan.LaunchDomain != nil {
		p.domains[*plan.LaunchDomain] = true
	}
	for _, key := range append(append([]string(nil), plan.Claims...), plan.Overrides...) {
		if p.claimed[key] {
			return rules.Fail("RUNTIME_NORMALIZATION_CONFLICT")
		}
		p.claimed[key] = true
	}
	p.plans = append(p.plans, planned{plugin, plan})
	return nil
}

// outputsDisjoint: outputs never collide with each other or with unclaimed content they do not override.
func (p *phasePlans) outputsDisjoint() bool {
	targets := map[string]bool{}
	for key := range p.files {
		if !p.claimed[key] {
			targets[key] = true
		}
	}
	for _, item := range p.plans {
		for _, key := range item.plan.Outputs {
			if targets[key] || p.files[key] && !containsString(item.plan.Claims, key) &&
				!containsString(item.plan.Overrides, key) {
				return false
			}
			targets[key] = true
		}
	}
	return true
}

// planPhase probes every registration before conversion; overlapping claims are a deterministic error.
func planPhase(input *pipeline.Context, plugins []*pipeline.Plugin) ([]planned, error) {
	phase := &phasePlans{files: map[string]bool{}, claimed: map[string]bool{}, domains: map[string]bool{}}
	for _, file := range input.Files {
		phase.files[file.LogicalKey] = true
	}
	for _, plugin := range plugins {
		if input.Ctx.Err() != nil {
			return nil, rules.Fail("RUNTIME_CANCELLED")
		}
		matches, err := plugin.Probe(input)
		if err != nil {
			return nil, fmt.Errorf("probe: %w", err)
		}
		for _, plan := range matches {
			if err := phase.add(plugin, plan); err != nil {
				return nil, err
			}
		}
	}
	if len(phase.domains) > 1 {
		return nil, rules.Fail("RUNTIME_NORMALIZATION_LAUNCH_AMBIGUOUS")
	}
	if !phase.outputsDisjoint() {
		return nil, rules.Fail("RUNTIME_NORMALIZATION_CONFLICT")
	}
	return phase.plans, nil
}

func validateOutputs(ctx context.Context, files []pipeline.OutputFile, root string) {
	outputInvalid(len(files) > 0 && len(files) <= 100000)
	seen := map[string]bool{}
	for _, file := range files {
		checkCancel(ctx)
		outputInvalid(rules.SafePath(file.LogicalKey) && !seen[file.LogicalKey] && file.Path == filepath.Join(root,
			file.LogicalKey) &&
			file.SizeBytes == float64(int64(file.SizeBytes)) && file.SizeBytes >= 0 && file.SizeBytes <= maximumFile &&
			rules.Digest(file.SHA256))
		seen[file.LogicalKey] = true
		info, err := os.Lstat(file.Path)
		outputInvalid(err == nil && info.Mode().IsRegular() && info.Size() == file.Size())
		resolved, err := filepath.EvalSymlinks(file.Path)
		outputInvalid(err == nil && resolved == file.Path)
		locator := &content.Locator{Path: file.Path, SizeBytes: file.SizeBytes}
		hash := newHash()
		outputInvalid(content.Stream(ctx, locator, 0, file.Size(), hash) == nil && hash.hex() == file.SHA256)
	}
}

// Receipt is one plugin's normalization receipt.
type Receipt struct {
	ID         string         `json:"id"`
	Version    int            `json:"version"`
	Formats    []string       `json:"formats"`
	Sources    []Fact         `json:"sources"`
	Outputs    []Fact         `json:"outputs"`
	Validation map[string]int `json:"validation"`
}

// Fact is a file size/digest fact.
type Fact struct {
	File      string  `json:"file"`
	SizeBytes float64 `json:"sizeBytes"`
	SHA256    string  `json:"sha256"`
}

// Summary is the bounded normalization receipt returned to the host.
type Summary struct {
	Kind                   string             `json:"kind"`
	ConverterVersion       int                `json:"converterVersion"`
	SourceContentHash      string             `json:"sourceContentHash"`
	ArchiveCount           int                `json:"archiveCount"`
	VerifiedEntries        int                `json:"verifiedEntries"`
	MetadataCorrections    int                `json:"metadataCorrections"`
	OmittedPhysicalEntries int                `json:"omittedPhysicalEntries"`
	FormatCounts           map[string]int     `json:"formatCounts"`
	Warnings               []pipeline.Warning `json:"warnings"`
	Details                []map[string]any   `json:"details"`
	Plugins                []*Receipt         `json:"plugins"`
}

var validationKeys = []string{
	"outputFilesVerified", "resourceEntriesVerified", "metadataCorrections",
	"omittedPhysicalEntries",
}

func appendReceipt(summary *Summary, plugin *pipeline.Plugin, plan *pipeline.Plan, result *pipeline.Result,
	files []rules.File,
) {
	current := &Receipt{
		ID: plugin.ID, Version: plugin.Version, Formats: []string{plan.Format}, Sources: []Fact{},
		Outputs: []Fact{},
	}
	for _, file := range files {
		if containsString(plan.Claims, file.LogicalKey) || containsString(plan.Overrides, file.LogicalKey) {
			current.Sources = append(current.Sources, Fact{file.LogicalKey, file.SizeBytes, file.SHA256})
		}
	}
	for _, file := range result.Files {
		current.Outputs = append(current.Outputs, Fact{file.LogicalKey, file.SizeBytes, file.SHA256})
	}
	pluginSummary := result.Summary
	if pluginSummary == nil {
		pluginSummary = &pipeline.Summary{}
	}
	current.Validation = map[string]int{
		"outputFilesVerified": len(result.Files), "resourceEntriesVerified": pluginSummary.VerifiedEntries,
		"metadataCorrections":    pluginSummary.MetadataCorrections,
		"omittedPhysicalEntries": pluginSummary.OmittedPhysicalEntries,
	}
	if previous := findReceipt(summary, plugin.ID); previous != nil {
		previous.Formats = sortedUnique(append(previous.Formats, current.Formats...))
		previous.Sources = append(previous.Sources, current.Sources...)
		previous.Outputs = append(previous.Outputs, current.Outputs...)
		for _, key := range validationKeys {
			previous.Validation[key] += current.Validation[key]
		}
	} else {
		summary.Plugins = append(summary.Plugins, current)
	}
	archives := 1
	if pluginSummary.ArchiveCount != nil {
		archives = *pluginSummary.ArchiveCount
		summary.ArchiveCount += archives
	}
	summary.VerifiedEntries += pluginSummary.VerifiedEntries
	summary.MetadataCorrections += pluginSummary.MetadataCorrections
	summary.OmittedPhysicalEntries += pluginSummary.OmittedPhysicalEntries
	summary.FormatCounts[plan.Format] += archives
	for _, warning := range pluginSummary.Warnings {
		if previous := findWarning(summary, warning.Code); previous != nil {
			previous.Count += warning.Count
		} else {
			summary.Warnings = append(summary.Warnings, warning)
		}
	}
	summary.Details = append(summary.Details, pluginSummary.Details...)
	for _, key := range plan.Overrides {
		source, output := rules.FindFile(files, key), findOutput(result.Files, key)
		summary.Details = append(summary.Details, map[string]any{
			"code": "CONTAINER_FILE_OVERRIDE", "file": plan.Claims[0],
			"member": key, "sourceSha256": source.SHA256, "outputSha256": output.SHA256, "sourceSize": source.SizeBytes,
			"outputSize": output.SizeBytes,
		})
	}
	encoded, err := json.Marshal(summary)
	outputInvalid(len(summary.Details) <= 2048 && err == nil && len(encoded) <= 4*1024*1024,
		"RUNTIME_NORMALIZATION_AUDIT_LIMIT")
}

func findReceipt(summary *Summary, id string) *Receipt {
	for _, receipt := range summary.Plugins {
		if receipt.ID == id {
			return receipt
		}
	}
	return nil
}

func findWarning(summary *Summary, code string) *pipeline.Warning {
	for index := range summary.Warnings {
		if summary.Warnings[index].Code == code {
			return &summary.Warnings[index]
		}
	}
	return nil
}

func findOutput(files []pipeline.OutputFile, key string) *pipeline.OutputFile {
	for index := range files {
		if files[index].LogicalKey == key {
			return &files[index]
		}
	}
	return nil
}

func sortedUnique(values []string) []string {
	unique := uniqueSet(values)
	result := make([]string, 0, len(unique))
	for value := range unique {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

// entry is an effective file fact; Path is set for converted outputs.
type entry struct {
	rules.File
	Path string `json:"path,omitempty"`
}

func convertPhase(input *pipeline.Context, plans []planned, outputRoot string, summary *Summary,
	staged map[string]string,
) (*pipeline.Context, error) {
	changed := map[string]bool{}
	for _, item := range plans {
		for _, key := range append(append([]string(nil), item.plan.Claims...), item.plan.Overrides...) {
			changed[key] = true
		}
	}
	var files []rules.File
	for _, file := range input.Files {
		if !changed[file.LogicalKey] {
			files = append(files, file)
		}
	}
	var outputs []pipeline.OutputFile
	for _, item := range plans {
		checkCancel(input.Ctx)
		phase := *input
		phase.OutputRoot = outputRoot
		result, err := item.plugin.Convert(&phase, item.plan)
		if err != nil {
			return nil, fmt.Errorf("convert: %w", err)
		}
		validateOutputs(input.Ctx, result.Files, outputRoot)
		outputInvalid(len(result.Files) == len(item.plan.Outputs))
		for _, file := range result.Files {
			outputInvalid(containsString(item.plan.Outputs, file.LogicalKey))
		}
		outputs = append(outputs, result.Files...)
		appendReceipt(summary, item.plugin, item.plan, result, input.Files)
	}
	for _, file := range outputs {
		files = append(files, file.File)
	}
	sort.SliceStable(files, func(i, j int) bool { return files[i].LogicalKey < files[j].LogicalKey })
	total := int64(0)
	for _, file := range files {
		total += file.Size()
	}
	outputInvalid(len(files) <= 100000 && total <= maximumTree)
	for key := range changed {
		delete(staged, key)
	}
	locators := map[string]content.Locator{}
	for key, value := range input.Locators {
		if !changed[key] {
			locators[key] = value
		}
	}
	for _, file := range outputs {
		staged[file.LogicalKey] = file.Path
		locators[file.LogicalKey] = content.Locator{Path: file.Path, SizeBytes: file.SizeBytes}
	}
	next := *input
	next.Files, next.Locators = files, locators
	return &next, nil
}

// Result is the normalization command result.
type Result struct {
	Files         []entry  `json:"files"`
	Normalization *Summary `json:"normalization,omitempty"`
}

// Run executes both phases in private roots; only verified final files reach the flat outputRoot.
func Run(ctx context.Context, platformID string, files []rules.File, locators map[string]content.Locator, outputRoot,
	workspaceRoot string,
) (*Result, error) {
	sorted := append([]rules.File(nil), files...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].LogicalKey < sorted[j].LogicalKey })
	keys := map[string]bool{}
	for _, file := range sorted {
		if keys[file.LogicalKey] || !rules.SafePath(file.LogicalKey) {
			return nil, rules.Fail("RUNTIME_NORMALIZATION_INPUT_INVALID")
		}
		keys[file.LogicalKey] = true
	}
	selected := registry(Registry, platformID)
	hash, err := rules.ContentHash(sorted, "TREE")
	if err != nil {
		return nil, fmt.Errorf("content hash: %w", err)
	}
	input := &pipeline.Context{
		Ctx: ctx, Sources: pipeline.Sources{Files: sorted, Locators: locators}, PlatformID: platformID,
		Original: pipeline.Sources{Files: sorted, Locators: locators}, SourceContentHash: hash, AuditRoot: outputRoot,
	}
	summary := &Summary{
		Kind: "CONTENT_NORMALIZATION", ConverterVersion: 1, SourceContentHash: hash, FormatCounts: map[string]int{},
		Warnings: []pipeline.Warning{}, Details: []map[string]any{}, Plugins: []*Receipt{},
	}
	staged := map[string]string{}
	for _, phase := range []string{"container", "resource"} {
		if input, err = runPhase(input, phasePlugins(selected, phase), filepath.Join(workspaceRoot, phase), summary,
			staged); err != nil {
			return nil, err
		}
	}
	checkCancel(ctx)
	if len(summary.Plugins) == 0 {
		return passthrough(files), nil
	}
	result := &Result{Normalization: summary}
	for _, file := range input.Files {
		checkCancel(ctx)
		item, err := publish(file, staged, outputRoot)
		if err != nil {
			return nil, err
		}
		result.Files = append(result.Files, item)
	}
	return result, nil
}

func phasePlugins(selected []*pipeline.Plugin, phase string) []*pipeline.Plugin {
	var plugins []*pipeline.Plugin
	for _, plugin := range selected {
		if plugin.Phase == phase {
			plugins = append(plugins, plugin)
		}
	}
	return plugins
}

// runPhase plans and converts one phase; a phase without plans leaves its input unchanged.
func runPhase(input *pipeline.Context, plugins []*pipeline.Plugin, root string, summary *Summary,
	staged map[string]string,
) (*pipeline.Context, error) {
	// Probes cannot reuse source-dependent caches across an overlay boundary.
	input.Cache = pipeline.NewCache()
	plans, err := planPhase(input, plugins)
	if err != nil || len(plans) == 0 {
		return input, err
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		return nil, rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID")
	}
	return convertPhase(input, plans, root, summary, staged)
}

// publish moves a staged output into the request output root.
func publish(file rules.File, staged map[string]string, outputRoot string) (entry, error) {
	item := entry{File: file}
	source, exists := staged[file.LogicalKey]
	if !exists {
		return item, nil
	}
	item.Path = filepath.Join(outputRoot, file.LogicalKey)
	if err := os.MkdirAll(filepath.Dir(item.Path), 0o700); err != nil {
		return item, rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID")
	}
	if err := os.Rename(source, item.Path); err != nil {
		return item, rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID")
	}
	return item, nil
}

func passthrough(files []rules.File) *Result {
	result := &Result{Files: make([]entry, len(files))}
	for index, file := range files {
		result.Files[index] = entry{File: file}
	}
	return result
}

// Normalize owns the request output and workspace: failures and cancellation reclaim both.
func Normalize(ctx context.Context, platformID string, files []rules.File, locators map[string]content.Locator,
	outputRoot string,
) (*Result, error) {
	if !Supports(platformID) {
		return passthrough(files), nil
	}
	if !filepath.IsAbs(outputRoot) || filepath.Clean(outputRoot) != outputRoot {
		return nil, rules.Fail("RUNTIME_CONTENT_LOCATOR_REQUIRED")
	}
	if err := os.Mkdir(outputRoot, 0o700); err != nil {
		return nil, rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID")
	}
	retain := false
	workspace, workspaceErr := os.MkdirTemp(filepath.Dir(outputRoot), ".normalization-")
	defer func() {
		if workspaceErr == nil {
			_ = os.RemoveAll(workspace)
		}
		if !retain || ctx.Err() != nil {
			_ = os.RemoveAll(outputRoot)
		}
	}()
	if workspaceErr != nil {
		return nil, rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID")
	}
	result, err := runRecovered(ctx, platformID, files, locators, outputRoot, workspace)
	if ctx.Err() != nil {
		return nil, rules.Fail("RUNTIME_CANCELLED")
	}
	if err != nil {
		return nil, publicFailure(err)
	}
	retain = result.Normalization != nil
	return result, nil
}

func runRecovered(ctx context.Context, platformID string, files []rules.File, locators map[string]content.Locator,
	outputRoot,
	workspace string,
) (*Result, error) {
	return guarded(func() (*Result, error) {
		return Run(ctx, platformID, files, locators, outputRoot, workspace)
	})
}

var reason = regexp.MustCompile(`^RUNTIME_[A-Z0-9_]+$`)

// publicFailure keeps stable reason codes; any other failure is a generic normalization failure.
func publicFailure(err error) error {
	var failure *rules.Failure
	if errors.As(err, &failure) && reason.MatchString(failure.Code) {
		return failure
	}
	return rules.Fail("RUNTIME_NORMALIZATION_FAILED")
}

type digestWriter struct{ hash hash.Hash }

func newHash() *digestWriter { return &digestWriter{hash: sha256.New()} }

func (d *digestWriter) Write(data []byte) (int, error) {
	d.hash.Write(data)
	return len(data), nil
}

func (d *digestWriter) hex() string { return hex.EncodeToString(d.hash.Sum(nil)) }
