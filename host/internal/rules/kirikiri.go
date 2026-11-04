package rules

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

// XP3Signature is the KiriKiri archive magic.
var XP3Signature = []byte{0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01}

// Evidence is host-read bounded content evidence keyed by logical path.
type Evidence struct {
	PrefixBase64 *string `json:"prefixBase64,omitempty"`
	Text         *string `json:"text,omitempty"`
}

var kirikiriEntryPattern = regexp.MustCompile(`(?i)(?:^|/)startup\.tjs$|\.xp3$`)

// KirikiriEntryCandidates lists entries by engine conventions and actual format evidence.
func KirikiriEntryCandidates(files []File, evidence map[string]Evidence) ([]string, error) {
	result := []string{}
	for index := range files {
		file := &files[index]
		matched := kirikiriEntryPattern.MatchString(file.LogicalKey)
		if !matched {
			xp3, err := isXP3(file, evidence)
			if err != nil {
				return nil, err
			}
			matched = xp3
		}
		if matched {
			result = append(result, file.LogicalKey)
		}
	}
	sortUTF8(result)
	return result, nil
}

func isXP3(file *File, evidence map[string]Evidence) (bool, error) {
	record, exists := evidence[file.LogicalKey]
	if !exists || record.PrefixBase64 == nil {
		return false, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(*record.PrefixBase64)
	if err != nil {
		return false, Fail("RUNTIME_EVIDENCE_INVALID")
	}
	if float64(len(decoded)) != min(file.SizeBytes, float64(len(XP3Signature))) {
		return false, Fail("RUNTIME_EVIDENCE_INVALID")
	}
	return bytes.HasPrefix(decoded, XP3Signature), nil
}

const (
	patchManifestBytes = 256 * 1024
	maximumResources   = 10_000
	maximumPatches     = 62
)

var manifestPattern = regexp.MustCompile(`^(.*/)?\.runtime-launches/([^/]+)\.json$`)

// IsKirikiriPatchManifest reports a recognized resource patch manifest path.
func IsKirikiriPatchManifest(path string) bool { return manifestPattern.MatchString(path) }

type patch struct{ overlayRoot, optionRoot, label string }

// LaunchItem is one read-only launch alternative.
type LaunchItem struct {
	ID            string         `json:"id"`
	Label         string         `json:"label"`
	Configuration *Configuration `json:"configuration"`
}

// LaunchOptions lists launch alternatives; saved explicit options remain unchanged.
type LaunchOptions struct {
	Items      []LaunchItem `json:"items"`
	SelectedID string       `json:"selectedId"`
}

// KirikiriPatchLaunches preserves entry selection and independent copies of all unrelated core options.
func KirikiriPatchLaunches(files []File, evidence map[string]Evidence, config *Configuration) (*LaunchOptions, error) {
	if config.Content.Kind != "KIRIKIRI_PROJECT" {
		return &LaunchOptions{Items: []LaunchItem{}}, nil
	}
	entry := *config.Content.EntryFile
	patches, err := discoverPatches(files, evidence, &entry)
	if err != nil {
		return nil, err
	}
	if len(patches) == 0 {
		return &LaunchOptions{Items: []LaunchItem{}}, nil
	}
	items := []LaunchItem{{ID: "original", Label: "原版资源", Configuration: withOverlay(config, nil)}}
	for _, item := range patches {
		root := item.optionRoot
		items = append(items, LaunchItem{ID: item.overlayRoot, Label: item.label, Configuration: withOverlay(config, &root)})
	}
	current, isText := coreOption(config, "kirikiri2", "overlayRoot").(string)
	if !isText {
		return &LaunchOptions{Items: items, SelectedID: "original"}, nil
	}
	for _, item := range patches {
		if item.optionRoot == current {
			return &LaunchOptions{Items: items, SelectedID: item.overlayRoot}, nil
		}
	}
	selected := "custom:" + current
	items = append(items, LaunchItem{ID: selected, Label: "自定义覆盖目录", Configuration: config.Clone()})
	return &LaunchOptions{Items: items, SelectedID: selected}, nil
}

type manifestFile struct {
	file        *File
	projectRoot string
	module      string
}

func discoverPatches(files []File, evidence map[string]Evidence, entryFile *string) ([]patch, error) {
	var manifests []manifestFile
	for index := range files {
		match := manifestPattern.FindStringSubmatch(files[index].LogicalKey)
		if match == nil || entryFile != nil && match[1] != Root(*entryFile) {
			continue
		}
		manifests = append(manifests, manifestFile{&files[index], match[1], match[2]})
	}
	if len(manifests) == 0 {
		return nil, nil
	}
	if len(manifests) > maximumPatches {
		return nil, patchInvalid(manifests[0].file.LogicalKey, "too many resource patch manifests")
	}
	sort.SliceStable(manifests, func(i, j int) bool {
		return UTF8Compare(manifests[i].file.LogicalKey, manifests[j].file.LogicalKey) < 0
	})
	index := make(map[string]*File, len(files))
	for position := range files {
		index[files[position].LogicalKey] = &files[position]
	}
	if len(index) != len(files) {
		return nil, patchInvalid(manifests[0].file.LogicalKey, "duplicate content paths")
	}
	patches := make([]patch, 0, len(manifests))
	roots := map[string]bool{}
	for _, manifest := range manifests {
		parsed, err := parsePatchManifest(evidence, index, &manifest)
		if err != nil {
			return nil, err
		}
		roots[parsed.overlayRoot] = true
		patches = append(patches, *parsed)
	}
	if len(roots) != len(patches) {
		return nil, patchInvalid(manifests[0].file.LogicalKey, "duplicate overlay roots")
	}
	return patches, nil
}

// patchSources: source files must belong to the project's original resources.
func patchSources(value any, files map[string]*File, path, projectRoot string) error {
	sources, err := factList(value, files, path)
	if err != nil {
		return err
	}
	for _, source := range sources {
		top := strings.SplitN(strings.TrimPrefix(source, projectRoot), "/", 2)[0]
		if !strings.HasPrefix(source, projectRoot) || top == ".runtime-patches" || top == ".runtime-launches" {
			return patchInvalid(path, "source files must belong to the project's original resources")
		}
	}
	return nil
}

// patchResources: the resource list is exactly the content below the overlay root.
func patchResources(value any, files map[string]*File, path, overlayRoot string) error {
	resources, err := factList(value, files, path)
	if err != nil {
		return err
	}
	listed := map[string]bool{}
	for _, resource := range resources {
		if !strings.HasPrefix(resource, overlayRoot+"/") {
			return patchInvalid(path, "resources must be inside their overlay root")
		}
		listed[resource] = true
	}
	for key := range files {
		if strings.HasPrefix(key, overlayRoot+"/") && !listed[key] {
			return patchInvalid(path, "unlisted overlay resource")
		}
	}
	return nil
}

func parsePatchManifest(evidence map[string]Evidence, files map[string]*File, manifest *manifestFile) (*patch, error) {
	path, projectRoot := manifest.file.LogicalKey, manifest.projectRoot
	text, err := manifestText(evidence, manifest.file)
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return nil, patchInvalid(path, "invalid JSON")
	}
	object, ok := Object(value)
	if !ok || !Exact(object, []string{"kind", "version", "sourceFiles", "overlayRoot", "resources"}) ||
		object["kind"] != "KIRIKIRI_RESOURCE_PATCH" || object["version"] != 1.0 {
		return nil, patchInvalid(path, "invalid manifest schema")
	}
	overlayRoot, _ := object["overlayRoot"].(string)
	if !LogicalPath(object["overlayRoot"], false) || !strings.HasPrefix(overlayRoot, projectRoot+".runtime-patches/") {
		return nil, patchInvalid(path, "overlay root must be a safe directory in the same project")
	}
	optionRoot := overlayRoot[len(projectRoot):]
	if UTF16Length(optionRoot) > 240 {
		return nil, patchInvalid(path, "overlay root exceeds the core option length limit")
	}
	if err := patchSources(object["sourceFiles"], files, path, projectRoot); err != nil {
		return nil, err
	}
	if err := patchResources(object["resources"], files, path, overlayRoot); err != nil {
		return nil, err
	}
	return &patch{overlayRoot: overlayRoot, optionRoot: optionRoot, label: "资源补丁：" + manifest.module}, nil
}

func manifestText(evidence map[string]Evidence, file *File) (string, error) {
	record := evidence[file.LogicalKey]
	if !LogicalPath(file.LogicalKey, false) || !Digest(file.SHA256) || !safeInteger(file.SizeBytes) ||
		file.SizeBytes < 0 ||
		file.SizeBytes > patchManifestBytes || record.Text == nil || UTF16Length(*record.Text) > patchManifestBytes {
		return "", patchInvalid(file.LogicalKey, "manifest requires bounded text evidence")
	}
	data := []byte(*record.Text)
	if float64(len(data)) != file.SizeBytes || HashBytes(data) != file.SHA256 {
		return "", patchInvalid(file.LogicalKey, "manifest evidence does not match immutable file facts")
	}
	return *record.Text, nil
}

// fileFact decodes an exact {logicalKey, sizeBytes, sha256} fact.
func fileFact(item any) (map[string]any, string, float64, bool) {
	entry, isObject := Object(item)
	key, _ := entry["logicalKey"].(string)
	size, isNumber := entry["sizeBytes"].(float64)
	valid := isObject && Exact(entry, []string{"logicalKey", "sizeBytes", "sha256"}) &&
		LogicalPath(entry["logicalKey"], false) && Digest(entry["sha256"]) && isNumber && safeInteger(size) && size >= 0
	return entry, key, size, valid
}

func factList(value any, files map[string]*File, manifest string) ([]string, error) {
	items, ok := value.([]any)
	if !ok || len(items) == 0 || len(items) > maximumResources {
		return nil, patchInvalid(manifest, "file lists must contain between 1 and 10000 entries")
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(items))
	for _, item := range items {
		entry, key, size, valid := fileFact(item)
		if !valid || seen[key] {
			return nil, patchInvalid(manifest, "invalid or duplicate file fact")
		}
		actual := files[key]
		if actual == nil || actual.SizeBytes != size || actual.SHA256 != entry["sha256"] {
			return nil, patchInvalid(manifest, "referenced file facts do not match content")
		}
		seen[key] = true
		result = append(result, key)
	}
	return result, nil
}

func withOverlay(config *Configuration, overlayRoot *string) *Configuration {
	result := config.Clone()
	if overlayRoot != nil {
		core := ensureCore(result, "kirikiri2")
		if core.Options == nil {
			options := map[string]any{}
			core.Options = &options
		}
		(*core.Options)["overlayRoot"] = *overlayRoot
		return result
	}
	core := result.Core("kirikiri2")
	if core == nil {
		return result
	}
	if core.Options != nil {
		delete(*core.Options, "overlayRoot")
		if len(*core.Options) == 0 {
			core.Options = nil
		}
	}
	if core.Options == nil && core.ParentFiles == nil && core.ROMSet == nil {
		delete(*result.Cores, "kirikiri2")
	}
	if len(*result.Cores) == 0 {
		result.Cores = nil
	}
	return result
}

func patchInvalid(manifest, reason string) *Failure {
	return Fail("RUNTIME_PATCH_MANIFEST_INVALID", "manifest", manifest, "reason", reason)
}
