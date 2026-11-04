package host

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"unicode/utf8"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

func (s *Service) dosEntryCandidates(_ context.Context, input json.RawMessage) (any, error) {
	var value request
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	if _, err := rules.ContentHash(value.Files, "TREE"); err != nil {
		return nil, fmt.Errorf("content hash: %w", err)
	}
	object, _ := rules.Object(value.Config)
	draft, _ := rules.Object(object["content"])
	config, err := rules.ParseConfiguration(map[string]any{"content": map[string]any{
		"kind": draft["kind"], "entryFile": draft["entryFile"],
	}})
	if err != nil {
		return nil, fmt.Errorf("parse configuration: %w", err)
	}
	if config.Content.Kind != "DOS_BUNDLE" {
		return nil, rules.Invalid()
	}
	file := rules.FindFile(value.Files, *config.Content.EntryFile)
	if file == nil {
		return nil, rules.Fail("RUNTIME_ENTRY_MISSING")
	}
	members, err := value.members(file)
	if err != nil {
		return nil, runtimeCode(err)
	}
	return map[string]any{"entries": rules.DOSEntryCandidates(memberNames(members))}, nil
}

func (s *Service) rpgEntryCandidates(_ context.Context, input json.RawMessage) (any, error) {
	var value struct {
		Config any          `json:"config"`
		Files  []rules.File `json:"files"`
		Engine *string      `json:"engine"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	entries, err := rules.RPGEntryCandidates(value.Config, value.Files, value.Engine)
	if err != nil {
		return nil, fmt.Errorf("rpg entry candidates: %w", err)
	}
	return map[string]any{"entries": entries}, nil
}

type kirikiriInput struct {
	request
	PlatformID string                    `json:"platformId"`
	Evidence   map[string]rules.Evidence `json:"evidence"`
	After      *string                   `json:"after"`
	Prefix     *string                   `json:"prefix"`
	Limit      *float64                  `json:"limit"`
}

func queryPath(value *string) bool {
	return value == nil || len(*value) <= 1024 && utf8.ValidString(*value)
}

// entryLimit validates the KiriKiri query cursor, prefix and page size (an integer 1..100, default 100).
func entryLimit(value *kirikiriInput) (float64, bool) {
	limit := 100.0
	if value.Limit != nil {
		limit = *value.Limit
	}
	return limit, value.PlatformID == "kirikiri" && queryPath(value.After) && queryPath(value.Prefix) &&
		limit == float64(int(limit)) && limit >= 1 && limit <= 100
}

// kirikiriFileEntries classifies one file, reading its prefix only when names alone are not conclusive.
func (s *Service) kirikiriFileEntries(ctx context.Context, value *kirikiriInput, file *rules.File) ([]string, error) {
	single := []rules.File{*file}
	known, err := rules.KirikiriEntryCandidates(single, value.Evidence)
	if err != nil {
		return nil, fmt.Errorf("kirikiri entry candidates: %w", err)
	}
	if len(known) > 0 {
		return known, nil
	}
	evidence, err := s.kirikiriPrefixes(ctx, &value.request, single, value.Evidence)
	if err != nil {
		return nil, err
	}
	if known, err = rules.KirikiriEntryCandidates(single, evidence); err != nil {
		return nil, fmt.Errorf("kirikiri entry candidates: %w", err)
	}
	return known, nil
}

func (s *Service) kirikiriEntryCandidates(ctx context.Context, input json.RawMessage) (any, error) {
	var value kirikiriInput
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	limit, ok := entryLimit(&value)
	if !ok {
		return nil, rules.Invalid()
	}
	if _, err := rules.ContentHash(value.Files, "TREE"); err != nil {
		return nil, fmt.Errorf("content hash: %w", err)
	}
	after, prefix := optional(value.After), optional(value.Prefix)
	var files []rules.File
	for _, file := range value.Files {
		if file.LogicalKey > after && strings.HasPrefix(file.LogicalKey, prefix) {
			files = append(files, file)
		}
	}
	// Go string order is byte order, the cursor order of the protocol.
	sort.SliceStable(files, func(i, j int) bool { return files[i].LogicalKey < files[j].LogicalKey })
	entries := []string{}
	for index := range files {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("kirikiri entries: %w", err)
		}
		known, err := s.kirikiriFileEntries(ctx, &value, &files[index])
		if err != nil {
			return nil, err
		}
		entries = append(entries, known...)
		if len(entries) > int(limit) {
			break
		}
	}
	page := entries[:min(len(entries), int(limit))]
	var next any
	if len(entries) > int(limit) {
		next = page[len(page)-1]
	}
	return map[string]any{"entries": page, "nextCursor": next}, nil
}

func optional(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// kirikiriPrefixes adds bounded XP3 signature evidence for files lacking it.
func (s *Service) kirikiriPrefixes(ctx context.Context, input *request, files []rules.File,
	evidence map[string]rules.Evidence,
) (map[string]rules.Evidence, error) {
	result := make(map[string]rules.Evidence, len(evidence)+len(files))
	for key, record := range evidence {
		result[key] = record
	}
	for index := range files {
		file := &files[index]
		_, located := input.Locators[file.LogicalKey]
		if file.SizeBytes < float64(len(rules.XP3Signature)) || result[file.LogicalKey].PrefixBase64 != nil || !located {
			continue
		}
		locator, err := input.locator(file)
		if err != nil {
			return nil, err
		}
		prefix, err := content.ReadPrefix(ctx, locator, int64(len(rules.XP3Signature)))
		if err != nil {
			return nil, fmt.Errorf("read prefix: %w", err)
		}
		encoded := base64.StdEncoding.EncodeToString(prefix)
		record := result[file.LogicalKey]
		record.PrefixBase64 = &encoded
		result[file.LogicalKey] = record
	}
	return result, nil
}

const (
	maximumManifests = 62
	maximumBytes     = 256 * 1024
)

// patchEvidence reads metadata from its exact immutable managed interval, including supplied evidence.
func (s *Service) patchEvidence(ctx context.Context, input *request, evidence map[string]rules.Evidence,
) (map[string]rules.Evidence, error) {
	var manifests []*rules.File
	for index := range input.Files {
		if rules.IsKirikiriPatchManifest(input.Files[index].LogicalKey) {
			manifests = append(manifests, &input.Files[index])
		}
	}
	if len(manifests) > maximumManifests {
		return nil, patchFailure(manifests[0].LogicalKey, "too many resource patch manifests")
	}
	result := make(map[string]rules.Evidence, len(evidence)+len(manifests))
	for key, record := range evidence {
		result[key] = record
	}
	for _, file := range manifests {
		text, err := readManifest(ctx, input, file)
		if err != nil {
			return nil, err
		}
		previous := result[file.LogicalKey]
		if previous.Text != nil && *previous.Text != text {
			return nil, rules.Fail("RUNTIME_CONTENT_CHANGED")
		}
		previous.Text = &text
		result[file.LogicalKey] = previous
	}
	return result, nil
}

func patchFailure(manifest, reason string) *rules.Failure {
	return rules.Fail("RUNTIME_PATCH_MANIFEST_INVALID", "manifest", manifest, "reason", reason)
}

func readManifest(ctx context.Context, input *request, file *rules.File) (string, error) {
	if file.SizeBytes < 0 || file.SizeBytes > maximumBytes || file.SizeBytes != float64(int64(file.SizeBytes)) {
		return "", patchFailure(file.LogicalKey, "manifest exceeds bounded text evidence")
	}
	locator, err := input.locator(file)
	if err != nil {
		return "", err
	}
	data, err := content.ReadPrefix(ctx, locator, int64(locator.SizeBytes))
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("manifest: %w", ctx.Err())
		}
		return "", runtimeCode(err)
	}
	if float64(len(data)) != file.SizeBytes || content.SHA256(data) != file.SHA256 {
		return "", rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	if !utf8.Valid(data) {
		return "", patchFailure(file.LogicalKey, "manifest must contain valid UTF-8")
	}
	return string(data), nil
}

type launchInput struct {
	request
	PlatformID string                    `json:"platformId"`
	Evidence   map[string]rules.Evidence `json:"evidence"`
}

func (s *Service) launchOptionsCommand(ctx context.Context, input json.RawMessage) (any, error) {
	var value launchInput
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	config, err := rules.ParseConfiguration(value.Config)
	if err != nil {
		return nil, fmt.Errorf("parse configuration: %w", err)
	}
	if value.PlatformID != "kirikiri" {
		return &rules.LaunchOptions{Items: []rules.LaunchItem{}}, nil
	}
	return s.launchOptionsFor(ctx, &value.request, value.Evidence, config)
}

// launchOptions validates launch alternatives during preparation.
func (s *Service) launchOptions(ctx context.Context, input *request, config *rules.Configuration,
) (*rules.LaunchOptions, error) {
	if input.Directory.PlatformID != "kirikiri" {
		return &rules.LaunchOptions{Items: []rules.LaunchItem{}}, nil
	}
	return s.launchOptionsFor(ctx, input, nil, config)
}

func (s *Service) launchOptionsFor(ctx context.Context, input *request, evidence map[string]rules.Evidence,
	config *rules.Configuration,
) (*rules.LaunchOptions, error) {
	if config.Content.Kind != "KIRIKIRI_PROJECT" {
		return &rules.LaunchOptions{Items: []rules.LaunchItem{}}, nil
	}
	if _, err := rules.ContentHash(input.Files, "TREE"); err != nil {
		return nil, fmt.Errorf("content hash: %w", err)
	}
	prepared, err := s.patchEvidence(ctx, input, evidence)
	if err != nil {
		return nil, err
	}
	result, err := rules.KirikiriPatchLaunches(input.Files, prepared, config)
	if err != nil {
		return nil, fmt.Errorf("kirikiri patch launches: %w", err)
	}
	return result, nil
}

// archiveEvidence reads the member lists of the uploaded archives among keys, once each.
func archiveEvidence(value *request, keys []string) (map[string][]rules.ArchiveMember, error) {
	archives := map[string][]rules.ArchiveMember{}
	for _, key := range keys {
		file := rules.FindFile(value.Files, key)
		if _, done := archives[key]; file == nil || done {
			continue
		}
		members, err := value.members(file)
		if err != nil {
			return nil, err
		}
		archives[key] = members
	}
	return archives, nil
}

// flycastParents offers parent archives for a Flycast cartridge; an attached CHD must be a valid disc image.
func (s *Service) flycastParents(value *request, config *rules.Configuration, coreID string,
	resolved *rules.Resolved,
) (any, error) {
	if value.AttachFile != nil && strings.HasSuffix(rules.Lower(*value.AttachFile), ".chd") {
		if err := validateCHD(value, *value.AttachFile); err != nil {
			return nil, err
		}
	}
	archives, catalog, err := s.flycastArchives(value, config, coreID, resolved)
	if err != nil {
		return nil, err
	}
	prepared := value.PrepareRequest
	prepared.Archives, prepared.FlycastCatalog, prepared.FlycastLoaded = archives, catalog, true
	result, err := s.facts.ArcadeParentOptions(&prepared, value.AttachFile)
	if err != nil {
		return nil, fmt.Errorf("arcade parent options: %w", err)
	}
	return result, nil
}

func (s *Service) arcadeParents(_ context.Context, input json.RawMessage) (any, error) {
	var value request
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	config, err := value.config()
	if err != nil {
		return nil, err
	}
	coreID := value.coreID()
	resolved, err := s.facts.ResolveTarget(value.Directory.PlatformID, coreID, &config.Content)
	if err != nil {
		return nil, fmt.Errorf("resolve target: %w", err)
	}
	prepared := value.PrepareRequest
	if requirements := resolved.Target.ContentRequirements; requirements != nil &&
		requirements.Kind == "FLYCAST_CARTRIDGE" {
		return s.flycastParents(&value, config, coreID, resolved)
	}
	if config.Content.Kind != "ARCADE" {
		return nil, rules.Invalid()
	}
	table, err := s.arcadeTable(coreID)
	if err != nil {
		return nil, err
	}
	keys := append([]string{*config.Content.EntryFile}, config.Core(coreID).Parents()...)
	if value.AttachFile != nil && strings.HasSuffix(rules.Lower(*value.AttachFile), ".zip") {
		keys = append(keys, *value.AttachFile)
	}
	if prepared.Archives, err = archiveEvidence(&value, keys); err != nil {
		return nil, err
	}
	prepared.ArcadeCatalog = table
	if prepared.CHDHeaders, err = s.mameMedia(&value, coreID); err != nil {
		return nil, err
	}
	result, err := s.facts.ArcadeParentOptions(&prepared, value.AttachFile)
	if err != nil {
		return nil, fmt.Errorf("arcade parent options: %w", err)
	}
	return result, nil
}

func (s *Service) romSets(_ context.Context, input json.RawMessage) (any, error) {
	var value rules.ROMSetRequest
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	coreID := ""
	if value.CoreID != nil {
		coreID = *value.CoreID
	}
	table, err := s.arcadeTable(coreID)
	if err != nil {
		return nil, err
	}
	result, err := s.facts.ROMSetOptions(&value, table)
	if err != nil {
		return nil, fmt.Errorf("rom set options: %w", err)
	}
	return result, nil
}

func (s *Service) reconcileConfig(_ context.Context, input json.RawMessage) (any, error) {
	var value struct {
		rules.ReconcileRequest
		ProviderRoots map[string]string `json:"providerRoots"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	tables, err := s.facts.ArcadeCatalogs()
	if err != nil {
		return nil, fmt.Errorf("arcade catalog: %w", err)
	}
	value.ArcadeCatalogs = tables
	object, _ := rules.Object(value.Config)
	cores, _ := rules.Object(object["cores"])
	coreIDs := make([]string, 0, len(cores))
	for id := range cores {
		coreIDs = append(coreIDs, id)
	}
	sort.Strings(coreIDs)
	if value.FlycastTables, err = s.flycastCatalogs(value.Directory.PlatformID, coreIDs, value.ProviderRoots); err != nil {
		return nil, err
	}
	result, err := s.facts.Reconcile(&value.ReconcileRequest)
	if err != nil {
		return nil, fmt.Errorf("reconcile: %w", err)
	}
	return result, nil
}

// flycastCatalogs loads the tables of single-file Flycast cores for configuration evidence.
func (s *Service) flycastCatalogs(platformID string, coreIDs []string, roots map[string]string,
) (map[string][]rules.FlycastMachine, error) {
	tables := map[string][]rules.FlycastMachine{}
	entry := "content"
	for _, coreID := range coreIDs {
		if !s.facts.SingleFileBinding(platformID, coreID) {
			continue
		}
		resolved, err := s.facts.ResolveTarget(platformID, coreID, &rules.Content{Kind: "SINGLE_FILE", EntryFile: &entry})
		if err != nil {
			return nil, fmt.Errorf("resolve target: %w", err)
		}
		if requirements := resolved.Target.ContentRequirements; requirements != nil &&
			requirements.Kind == "FLYCAST_CARTRIDGE" {
			if tables[coreID], err = s.flycastTable(roots[resolved.Binding.ProviderID], requirements); err != nil {
				return nil, err
			}
		}
	}
	return tables, nil
}

type biosFile struct {
	RequirementKey string `json:"requirementKey"`
	Path           string `json:"path"`
	Filename       string `json:"filename"`
}

type contentBIOSInput struct {
	request
	BIOSFiles []biosFile `json:"biosFiles"`
}

var runtimeReason = regexp.MustCompile(`^RUNTIME_[A-Z0-9_]+$`)

func (s *Service) batchContentBIOS(ctx context.Context, input json.RawMessage) (any, error) {
	var value struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	if value.Items == nil || len(value.Items) > 100 {
		return nil, rules.Fail("RUNTIME_REQUEST_TOO_LARGE")
	}
	results := make([]any, 0, len(value.Items))
	for _, raw := range value.Items {
		var item contentBIOSInput
		var result *rules.ContentBIOS
		err := decode(raw, &item)
		if err == nil {
			result, err = s.contentBIOS(ctx, &item)
		}
		if err != nil {
			code := "RUNTIME_CONTENT_UNAVAILABLE"
			if public := publicError(err); runtimeReason.MatchString(public.Code) {
				code = public.Code
			}
			results = append(results, map[string]any{
				"biosRequirements": []any{}, "crcWarnings": []any{},
				"missingRomMembers": []any{}, "error": code,
			})
			continue
		}
		results = append(results, struct {
			*rules.ContentBIOS
			Error any `json:"error"`
		}{result, nil})
	}
	return results, nil
}

// contentBIOS reads only evidence needed for BIOS rules; Parent and launch resources remain unprepared.
func (s *Service) contentBIOS(ctx context.Context, input *contentBIOSInput) (*rules.ContentBIOS, error) {
	if _, err := rules.ContentHash(input.Files, "TREE"); err != nil {
		return nil, fmt.Errorf("content hash: %w", err)
	}
	config, err := input.config()
	if err != nil {
		return nil, err
	}
	coreID := input.coreID()
	prepared := input.PrepareRequest
	if err := s.firmwareEvidence(ctx, &input.request, &prepared, config, coreID); err != nil {
		return nil, err
	}
	if config.Content.Kind == "ARCADE" {
		if err := s.arcadeBIOSEvidence(&input.request, &prepared, config, coreID); err != nil {
			return nil, err
		}
	}
	resolved, err := s.facts.ResolveTarget(input.Directory.PlatformID, coreID, &config.Content)
	if err != nil {
		return nil, fmt.Errorf("resolve target: %w", err)
	}
	if requirements := resolved.Target.ContentRequirements; requirements != nil &&
		requirements.Kind == "FLYCAST_CARTRIDGE" {
		if err := s.flycastEvidence(&input.request, &prepared, config, coreID, resolved); err != nil {
			return nil, err
		}
	}
	result, err := s.facts.ContentBIOSRequirements(&prepared)
	if err != nil {
		return nil, fmt.Errorf("content bios requirements: %w", err)
	}
	return result, s.auditBIOSMembers(input, result)
}

func (s *Service) arcadeBIOSEvidence(input *request, prepared *rules.PrepareRequest, config *rules.Configuration,
	coreID string,
) error {
	table, err := s.arcadeTable(coreID)
	if err != nil {
		return err
	}
	if table == nil {
		return rules.Fail("RUNTIME_ARCADE_CATALOG_UNAVAILABLE")
	}
	file := rules.FindFile(input.Files, *config.Content.EntryFile)
	if file == nil {
		return rules.Fail("RUNTIME_ENTRY_MISSING")
	}
	members, err := input.members(file)
	if err != nil {
		return err
	}
	archives := map[string][]rules.ArchiveMember{file.LogicalKey: members}
	for _, key := range config.Core(coreID).Parents() {
		if parent := rules.FindFile(input.Files, key); parent != nil {
			if archives[key], err = input.members(parent); err != nil {
				return err
			}
		}
	}
	prepared.ArcadeCatalog, prepared.Archives = table, archives
	prepared.CHDHeaders, err = s.mameMedia(input, coreID)
	return err
}

// missingBIOSMember reports a required firmware member absent from the archive, named by its ROM set.
func missingBIOSMember(requirement *rules.BIOSRequirement, expected *rules.BIOSMember, members []rules.ArchiveMember,
) *rules.MissingROMMember {
	if !expected.Required {
		return nil
	}
	name := requirement.LogicalName
	romSet := name
	if rules.HasSuffixFold(name, ".zip") {
		romSet = strings.TrimSuffix(name, name[max(0, len(name)-4):])
	}
	evidence := []rules.ArchiveMember{}
	if matchesBIOSMember(members, expected) {
		evidence = members
	}
	rom := &rules.ArcadeROM{Name: expected.Name, Size: fmt.Sprint(expected.SizeBytes), CRC: expected.CRC32}
	return rules.MissingMember(requirement.CoreID, romSet, "BIOS", rom, evidence)
}

func (s *Service) auditBIOSMembers(input *contentBIOSInput, result *rules.ContentBIOS) error {
	for _, requirement := range result.BIOSRequirements {
		file := findBIOSFile(input.BIOSFiles, requirement.RequirementKey)
		if file == nil || requirement.Members == nil || len(*requirement.Members) == 0 {
			continue
		}
		members, err := biosMembers(file.Path)
		if err != nil {
			return err
		}
		for _, expected := range *requirement.Members {
			if missing := missingBIOSMember(&requirement, &expected, members); missing != nil {
				result.MissingROMMembers = append(result.MissingROMMembers, *missing)
			}
			if member := biosMember(members, &expected); member != nil && member.CRC32 != expected.CRC32 {
				result.CRCWarnings = append(result.CRCWarnings, rules.CRCWarning{
					Role: "BIOS", File: file.Filename,
					Member: member.Name, ExpectedCRC32: rules.Lower(expected.CRC32), ActualCRC32: rules.Lower(member.CRC32),
				})
			}
		}
	}
	return nil
}

func findBIOSFile(files []biosFile, key string) *biosFile {
	for index := range files {
		if files[index].RequirementKey == key {
			return &files[index]
		}
	}
	return nil
}

func biosMember(members []rules.ArchiveMember, expected *rules.BIOSMember) *rules.ArchiveMember {
	for index := range members {
		if float64(members[index].SizeBytes) == expected.SizeBytes && members[index].CRC32 == expected.CRC32 {
			return &members[index]
		}
	}
	for index := range members {
		if members[index].Name == expected.Name && float64(members[index].SizeBytes) == expected.SizeBytes {
			return &members[index]
		}
	}
	return nil
}

func matchesBIOSMember(members []rules.ArchiveMember, expected *rules.BIOSMember) bool {
	for _, member := range members {
		if float64(member.SizeBytes) != expected.SizeBytes {
			continue
		}
		if expected.SHA1 != "" && member.SHA1 == rules.Lower(expected.SHA1) ||
			expected.SHA1 == "" && member.CRC32 == rules.Lower(expected.CRC32) {
			return true
		}
	}
	return false
}

type biosEvidence struct {
	members []rules.ArchiveMember
}

var (
	biosMutex sync.Mutex
	biosCache = map[string]*biosEvidence{}
	biosOrder []string
)

// biosMembers reads verified member digests, cached by the archive's content digest.
func biosMembers(path string) ([]rules.ArchiveMember, error) {
	digest, size, err := biosArchiveDigest(path)
	if err != nil {
		return nil, err
	}
	biosMutex.Lock()
	cached := biosCache[digest]
	biosMutex.Unlock()
	if cached != nil {
		return cached.members, nil
	}
	members, err := content.Members(&content.Locator{Path: path, SizeBytes: float64(size)},
		content.MemberOptions{Digests: true})
	if err != nil {
		return nil, fmt.Errorf("members: %w", err)
	}
	biosMutex.Lock()
	defer biosMutex.Unlock()
	if len(biosOrder) >= 128 {
		delete(biosCache, biosOrder[0])
		biosOrder = biosOrder[1:]
	}
	biosCache[digest] = &biosEvidence{members: members}
	biosOrder = append(biosOrder, digest)
	return members, nil
}

func biosArchiveDigest(path string) (string, int64, error) {
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "", 0, rules.Fail("RUNTIME_CONTENT_UNAVAILABLE")
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 512*1024*1024 {
		return "", 0, rules.Fail("RUNTIME_CONTENT_UNAVAILABLE")
	}
	hash := sha256.New()
	copied, err := io.Copy(hash, io.LimitReader(file, info.Size()))
	if err != nil || copied != info.Size() {
		return "", 0, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	return hex.EncodeToString(hash.Sum(nil)), info.Size(), nil
}

type identifyInput struct {
	File struct {
		SizeBytes float64 `json:"sizeBytes"`
		SHA256    string  `json:"sha256"`
		MD5       string  `json:"md5"`
		Name      *string `json:"name"`
	} `json:"file"`
	Requirements []rules.BIOSRequirement `json:"requirements"`
	Path         string                  `json:"path"`
}

func (s *Service) biosIdentify(_ context.Context, input json.RawMessage) (any, error) {
	var value identifyInput
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	name := optional(value.File.Name)
	direct := rules.IdentifyBIOSFile(value.File.SizeBytes, value.File.SHA256, value.File.MD5, name, value.File.Name != nil,
		value.Requirements)
	if value.Path == "" || !strings.HasSuffix(rules.Lower(name), ".zip") {
		return direct, nil
	}
	members, err := biosMembers(value.Path)
	if err != nil {
		return nil, err
	}
	identity := memberIdentity(members)
	names := memberNames(members)
	result := []rules.BIOSRequirement{}
	for _, requirement := range value.Requirements {
		candidate := identifyArchive(requirement, members, names, direct, name)
		if candidate == nil {
			continue
		}
		if candidate.Candidate != nil {
			candidate.Candidate.MemberIdentity = identity
		}
		result = append(result, *candidate)
	}
	return result, nil
}

// archiveShape: every listed entry is present and no excluded entry is.
func archiveShape(requirement *rules.BIOSRequirement, names []string) bool {
	for _, entry := range *requirement.ArchiveEntries {
		if !hasArchiveEntry(names, entry) {
			return false
		}
	}
	if requirement.ArchiveExcludes != nil {
		for _, entry := range *requirement.ArchiveExcludes {
			if hasArchiveEntry(names, entry) {
				return false
			}
		}
	}
	return true
}

func identifyArchive(requirement rules.BIOSRequirement, members []rules.ArchiveMember, names []string,
	direct []rules.BIOSRequirement, name string,
) *rules.BIOSRequirement {
	if requirement.ArchiveEntries != nil && len(*requirement.ArchiveEntries) > 0 {
		// Content alone identifies these packages; their names and digests vary by release and language.
		if !archiveShape(&requirement, names) {
			return nil
		}
		requirement.Candidate = &rules.BIOSCandidate{
			MatchedMembers: len(*requirement.ArchiveEntries),
			TotalMembers:   len(members),
		}
		return &requirement
	}
	if requirement.Members == nil || len(*requirement.Members) == 0 {
		for _, item := range direct {
			if item.RequirementKey == requirement.RequirementKey {
				return &requirement
			}
		}
		return nil
	}
	matched := 0
	complete := true
	for _, expected := range *requirement.Members {
		found := matchesBIOSMember(members, &expected)
		if found {
			matched++
		}
		complete = complete && (!expected.Required || found)
	}
	if rules.Lower(name) != rules.Lower(requirement.LogicalName) && !complete {
		return nil
	}
	requirement.Candidate = &rules.BIOSCandidate{MatchedMembers: matched, TotalMembers: len(members)}
	return &requirement
}

// memberIdentity hashes the sorted name/size/sha256 member list with JSON.stringify semantics.
func memberIdentity(members []rules.ArchiveMember) string {
	rows := append([]rules.ArchiveMember(nil), members...)
	sort.SliceStable(rows, func(i, j int) bool { return rules.UTF16Less(rows[i].Name, rows[j].Name) })
	var buffer bytes.Buffer
	buffer.WriteByte('[')
	for index, row := range rows {
		if index > 0 {
			buffer.WriteByte(',')
		}
		fmt.Fprintf(&buffer, "[%s,%d,%s]", rules.JSONString(row.Name), row.SizeBytes, rules.JSONString(row.SHA256))
	}
	buffer.WriteByte(']')
	return content.SHA256(buffer.Bytes())
}

// hasArchiveEntry: a trailing slash names a directory holding any member; names compare case-insensitively.
func hasArchiveEntry(names []string, entry string) bool {
	wanted := rules.Lower(entry)
	for _, name := range names {
		lower := rules.Lower(name)
		if strings.HasSuffix(wanted, "/") && strings.HasPrefix(lower, wanted) || lower == wanted {
			return true
		}
	}
	return false
}

// jsonNull is the result of a command whose answer is explicitly absent.
var jsonNull = json.RawMessage("null")

func (s *Service) biosVerify(_ context.Context, input json.RawMessage) (any, error) {
	var value struct {
		Requirement rules.BIOSRequirement `json:"requirement"`
		Path        string                `json:"path"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	requirement := value.Requirement
	if requirement.ArchiveEntries != nil && len(*requirement.ArchiveEntries) > 0 {
		return verifyArchiveEntries(*requirement.ArchiveEntries, value.Path), nil
	}
	if requirement.Members == nil || len(*requirement.Members) == 0 {
		return jsonNull, nil
	}
	expected := *requirement.Members
	members, err := biosMembers(value.Path)
	missing := []string{}
	matched := 0
	for _, member := range expected {
		found := err == nil && matchesBIOSMember(members, &member)
		if found {
			matched++
		} else if member.Required {
			missing = append(missing, member.Name)
		}
	}
	status := "valid"
	switch {
	case err != nil:
		status = "invalid"
	case len(missing) > 0:
		status = "incomplete"
	}
	return map[string]any{
		"status": status, "matchedMembers": matched, "expectedMembers": len(expected),
		"missingMembers": missing,
	}, nil
}

// verifyArchiveEntries requires entries at the archive root; only the central directory is read.
func verifyArchiveEntries(entries []string, path string) map[string]any {
	names := []string{}
	if info, err := os.Stat(path); err == nil {
		if members, err := content.Members(&content.Locator{Path: path, SizeBytes: float64(info.Size())},
			content.MemberOptions{}); err == nil {
			names = memberNames(members)
		}
	}
	missing := []string{}
	for _, entry := range entries {
		if !hasArchiveEntry(names, entry) {
			missing = append(missing, entry)
		}
	}
	matched := len(entries) - len(missing)
	status := "invalid"
	switch {
	case len(missing) == 0:
		status = "valid"
	case matched > 0:
		status = "incomplete"
	}
	return map[string]any{
		"status": status, "matchedMembers": matched, "expectedMembers": len(entries),
		"missingMembers": missing,
	}
}
