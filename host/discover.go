package host

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

type sourceCandidate struct {
	SourcePath   string  `json:"sourcePath"`
	HeaderBase64 string  `json:"headerBase64"`
	SizeBytes    float64 `json:"sizeBytes"`
	header       *rules.CHDHeader
}

type discoverInput struct {
	request
	SourceEntries    *[]string          `json:"sourceEntries"`
	SourceCandidates *[]sourceCandidate `json:"sourceCandidates"`
}

type discovered struct {
	LogicalKey   string `json:"logicalKey"`
	RelativeTo   string `json:"relativeTo,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
	SourcePath   string `json:"sourcePath,omitempty"`
	Optional     *bool  `json:"optional,omitempty"`
}

// discoverContent returns source names; the Host authorizes and copies their actual bytes.
func (s *Service) discoverContent(ctx context.Context, input json.RawMessage) (any, error) {
	var value discoverInput
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	if _, err := rules.ContentHash(value.Files, "TREE"); err != nil {
		return nil, fmt.Errorf("content hash: %w", err)
	}
	directory := value.Directory
	if directory.PlatformID == "psp" && directory.DefaultCoreID == "ppsspp" {
		return s.discoverPSP(&value)
	}
	found := []discovered{}
	if containsString(s.facts.ContentEntryExtensions(directory.PlatformID, directory.DefaultCoreID), "cue") {
		cue, err := discoverCue(ctx, &value)
		if err != nil {
			return nil, err
		}
		found = cue
	}
	if directory.PlatformID == "arcade" && directory.DefaultCoreID == "mame_arcade" {
		return s.discoverMAME(&value, found)
	}
	if s.facts.SingleFileBinding(directory.PlatformID, directory.DefaultCoreID) {
		flycast, err := s.discoverFlycast(&value)
		if err != nil {
			return nil, err
		}
		found = append(found, flycast...)
	}
	return map[string]any{"files": uniqueDiscovered(found)}, nil
}

// discoverCue lists the files referenced by each uploaded CUE sheet.
func discoverCue(ctx context.Context, value *discoverInput) ([]discovered, error) {
	found := []discovered{}
	for index := range value.Files {
		if !strings.HasSuffix(rules.Lower(value.Files[index].LogicalKey), ".cue") {
			continue
		}
		references, err := cueReferences(ctx, &value.request, &value.Files[index])
		if err != nil {
			return nil, err
		}
		for _, reference := range references {
			found = append(found, discovered{
				LogicalKey: reference.LogicalKey, RelativeTo: reference.RelativeTo,
				RelativePath: reference.RelativePath,
			})
		}
	}
	return found, nil
}

// uniqueDiscovered keeps the first discovery of each logical path.
func uniqueDiscovered(found []discovered) []discovered {
	unique := []discovered{}
	seen := map[string]bool{}
	for _, file := range found {
		if !seen[file.LogicalKey] {
			seen[file.LogicalKey] = true
			unique = append(unique, file)
		}
	}
	return unique
}

var pbpMagic = []byte{0, 80, 66, 80}

func (s *Service) discoverPSP(value *discoverInput) (any, error) {
	trees := []string{}
	for index := range value.Files {
		file := &value.Files[index]
		if !rules.HasSuffixFold(file.LogicalKey, ".pbp") ||
			value.SourceEntries != nil && !containsString(*value.SourceEntries, file.LogicalKey) {
			continue
		}
		locator, err := value.locator(file)
		if err != nil {
			return nil, err
		}
		header, err := readLocated(locator, 40)
		if err != nil {
			return nil, err
		}
		if len(header) == 40 && bytes.Equal(header[:4], pbpMagic) {
			trees = append(trees, file.LogicalKey)
		}
	}
	return map[string]any{"files": []any{}, "trees": trees}, nil
}

func (s *Service) discoverFlycast(value *discoverInput) ([]discovered, error) {
	directory := value.Directory
	entry := "content"
	resolved, err := s.facts.ResolveTarget(directory.PlatformID, directory.DefaultCoreID,
		&rules.Content{Kind: "SINGLE_FILE", EntryFile: &entry})
	if err != nil {
		return nil, fmt.Errorf("resolve target: %w", err)
	}
	requirements := resolved.Target.ContentRequirements
	if requirements == nil || requirements.Kind != "FLYCAST_CARTRIDGE" {
		return nil, nil
	}
	catalog, err := s.flycastTable(value.ProviderRoots[resolved.Binding.ProviderID], requirements)
	if err != nil {
		return nil, err
	}
	var found []discovered
	for index := range value.Files {
		file := &value.Files[index]
		if !rules.HasSuffixFold(file.Name, ".zip") {
			continue
		}
		base := rules.BaseName(file.Name)
		name := rules.Lower(base[:len(base)-4])
		var machine *rules.FlycastMachine
		for position := range catalog {
			if catalog[position].Name == name && catalog[position].Platform == directory.PlatformID {
				machine = &catalog[position]
				break
			}
		}
		if machine == nil || machine.MediaType != "CARTRIDGE" && machine.MediaType != "GDROM" {
			continue
		}
		members, err := value.members(file)
		if err != nil {
			return nil, err
		}
		for _, reference := range rules.FlycastContentReferences(machine, file, members, catalog) {
			found = append(found, discovered{
				LogicalKey: reference.LogicalKey, RelativeTo: reference.RelativeTo,
				RelativePath: reference.RelativePath, Optional: reference.Optional,
			})
		}
	}
	return found, nil
}

// mameDisks lists the disk requirements of every uploaded non-BIOS machine archive.
func mameDisks(files []rules.File, catalog *rules.ArcadeCatalog) ([]rules.DiskRequirement, error) {
	var requirements []rules.DiskRequirement
	for index := range files {
		file := &files[index]
		if !rules.HasSuffixFold(file.Name, ".zip") {
			continue
		}
		base := rules.BaseName(file.Name)
		name := rules.Lower(base[:len(base)-4])
		if machine := catalog.Machine(name); machine != nil && !machine.BIOS {
			disks, err := rules.DiskRequirements(name, catalog)
			if err != nil {
				return nil, fmt.Errorf("disk requirements: %w", err)
			}
			requirements = append(requirements, disks...)
		}
	}
	return requirements, nil
}

// diskSources ranks matching sources: standalone images first, then the expected path, then path order.
func diskSources(candidates []sourceCandidate, requirement *rules.DiskRequirement) []sourceCandidate {
	var matches []sourceCandidate
	for _, candidate := range candidates {
		if requirement.Disk.SHA1 != nil && *requirement.Disk.SHA1 != "" && candidate.header.SHA1 == *requirement.Disk.SHA1 {
			matches = append(matches, candidate)
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		left, right := matches[i], matches[j]
		if (left.header.ParentSHA1 != nil) != (right.header.ParentSHA1 != nil) {
			return left.header.ParentSHA1 == nil
		}
		if (left.SourcePath == requirement.Path) != (right.SourcePath == requirement.Path) {
			return left.SourcePath == requirement.Path
		}
		return rules.UTF16Less(left.SourcePath, right.SourcePath)
	})
	return matches
}

// discoverMAME supplies bounded headers from the metadata-directory root, never arbitrary filesystem access.
func (s *Service) discoverMAME(value *discoverInput, found []discovered) (any, error) {
	catalog, err := s.arcadeTable("mame_arcade")
	if err != nil {
		return nil, err
	}
	requirements, err := mameDisks(value.Files, catalog)
	if err != nil {
		return nil, err
	}
	if len(requirements) == 0 {
		return map[string]any{"files": found}, nil
	}
	if value.SourceCandidates == nil {
		return map[string]any{"files": found, "sourceSearch": map[string]any{
			"extensions":  []string{"chd"},
			"headerBytes": 124,
		}}, nil
	}
	candidates, err := chdCandidates(*value.SourceCandidates)
	if err != nil {
		return nil, err
	}
	optional := true
	for _, requirement := range requirements {
		if matches := diskSources(candidates, &requirement); len(matches) > 0 {
			found = append(found, discovered{
				LogicalKey: requirement.Path, SourcePath: matches[0].SourcePath,
				Optional: &optional,
			})
		}
	}
	return map[string]any{"files": found}, nil
}

func chdCandidates(sources []sourceCandidate) ([]sourceCandidate, error) {
	if len(sources) > 100000 {
		return nil, rules.Fail("RUNTIME_CONTENT_INVALID")
	}
	var candidates []sourceCandidate
	for _, candidate := range sources {
		if !rules.SafePath(candidate.SourcePath) || len(candidate.HeaderBase64) > 168 ||
			candidate.SizeBytes < 0 || candidate.SizeBytes != float64(int64(candidate.SizeBytes)) {
			return nil, rules.Fail("RUNTIME_CONTENT_INVALID")
		}
		header, err := base64.StdEncoding.DecodeString(candidate.HeaderBase64)
		if err != nil {
			continue
		}
		parsed, err := rules.ParseCHDHeader(header, int64(candidate.SizeBytes))
		if err != nil {
			continue
		}
		candidate.header = parsed
		candidates = append(candidates, candidate)
	}
	return candidates, nil
}
