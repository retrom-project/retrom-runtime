package host

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

// request is the common host request shape: rules input plus located files.
type request struct {
	rules.PrepareRequest
	Locators      map[string]content.Locator `json:"locators"`
	ProviderRoots map[string]string          `json:"providerRoots"`
	AttachFile    *string                    `json:"attachFile"`
}

func (r *request) locator(file *rules.File) (*content.Locator, error) {
	result, err := content.Require(r.Locators, file)
	if err != nil {
		return nil, fmt.Errorf("content locator: %w", err)
	}
	return result, nil
}

func (r *request) members(file *rules.File) ([]rules.ArchiveMember, error) {
	locator, err := r.locator(file)
	if err != nil {
		return nil, err
	}
	result, err := content.Members(locator, content.MemberOptions{})
	if err != nil {
		return nil, fmt.Errorf("archive members: %w", err)
	}
	return result, nil
}

func (s *Service) arcadeTable(coreID string) (*rules.ArcadeCatalog, error) {
	tables, err := s.facts.ArcadeCatalogs()
	if err != nil {
		return nil, fmt.Errorf("arcade catalog: %w", err)
	}
	return tables[coreID], nil
}

func (r *request) config() (*rules.Configuration, error) {
	config, err := rules.ParseConfiguration(r.Config)
	if err != nil {
		return nil, fmt.Errorf("parse configuration: %w", err)
	}
	return config, nil
}

func (r *request) coreID() string {
	if r.CoreID != nil {
		return *r.CoreID
	}
	return r.Directory.DefaultCoreID
}

// prepareInput reads the evidence a launch preparation needs.
// discEvidence resolves a CUE entry's files and the firmware region evidence of the disc.
func (s *Service) discEvidence(ctx context.Context, input *request, prepared *rules.PrepareRequest,
	config *rules.Configuration, coreID string,
) error {
	if config.Content.Kind == "SINGLE_FILE" && strings.HasSuffix(rules.Lower(*config.Content.EntryFile), ".cue") {
		cue, err := s.cueFiles(ctx, input, *config.Content.EntryFile)
		if err != nil {
			return err
		}
		prepared.CueFiles, prepared.CueKnown = cue, true
	}
	return s.firmwareEvidence(ctx, input, prepared, config, coreID)
}

func (s *Service) prepareInput(ctx context.Context, input *request) (*rules.PrepareRequest, error) {
	resolved, err := s.facts.ResolveSaved(&input.PrepareRequest)
	if err != nil {
		return nil, fmt.Errorf("resolve saved: %w", err)
	}
	input.PrepareRequest = *resolved
	config, err := input.config()
	if err != nil {
		return nil, err
	}
	if config.Content.Kind == "KIRIKIRI_PROJECT" {
		if _, err := s.launchOptions(ctx, input, config); err != nil {
			return nil, err
		}
	}
	if config.Content.Kind == "DOS_BUNDLE" && config.Content.EntryPath != nil {
		return s.dosPrepareInput(input, config)
	}
	prepared := input.PrepareRequest
	coreID := input.coreID()
	if err := s.discEvidence(ctx, input, &prepared, config, coreID); err != nil {
		return nil, err
	}
	resolvedTarget, err := s.facts.ResolveTarget(input.Directory.PlatformID, coreID, &config.Content)
	if err != nil {
		return nil, fmt.Errorf("resolve target: %w", err)
	}
	if requirements := resolvedTarget.Target.ContentRequirements; requirements != nil &&
		requirements.Kind == "FLYCAST_CARTRIDGE" {
		if err := s.flycastEvidence(input, &prepared, config, coreID, resolvedTarget); err != nil {
			return nil, err
		}
		return &prepared, nil
	}
	if config.Content.Kind != "ARCADE" {
		return &prepared, nil
	}
	return s.arcadePrepareInput(input, config, coreID)
}

func (s *Service) dosPrepareInput(input *request, config *rules.Configuration) (*rules.PrepareRequest, error) {
	file := rules.FindFile(input.Files, *config.Content.EntryFile)
	if file == nil {
		return nil, rules.Fail("RUNTIME_ENTRY_MISSING")
	}
	members, err := input.members(file)
	if err != nil {
		return nil, err
	}
	prepared := input.PrepareRequest
	prepared.DOSEntries = memberNames(members)
	return &prepared, nil
}

func (s *Service) arcadePrepareInput(input *request, config *rules.Configuration, coreID string,
) (*rules.PrepareRequest, error) {
	table, err := s.arcadeTable(coreID)
	if err != nil {
		return nil, err
	}
	if table == nil {
		return nil, rules.Fail("RUNTIME_ARCADE_CATALOG_UNAVAILABLE")
	}
	archives := map[string][]rules.ArchiveMember{}
	for _, key := range append([]string{*config.Content.EntryFile}, config.Core(coreID).Parents()...) {
		file := rules.FindFile(input.Files, key)
		if file == nil {
			return nil, rules.Fail("RUNTIME_ENTRY_MISSING")
		}
		if archives[key], err = input.members(file); err != nil {
			return nil, err
		}
	}
	// Firmware and cue evidence belong to other content kinds; arcade preparation starts from the request.
	prepared := input.PrepareRequest
	prepared.ArcadeCatalog, prepared.Archives = table, archives
	if prepared.CHDHeaders, err = s.mameMedia(input, coreID); err != nil {
		return nil, err
	}
	return &prepared, nil
}

func (s *Service) flycastEvidence(input *request, prepared *rules.PrepareRequest, config *rules.Configuration,
	coreID string, resolved *rules.Resolved,
) error {
	file := rules.FindFile(input.Files, *config.Content.EntryFile)
	if file == nil {
		return rules.Fail("RUNTIME_ENTRY_MISSING")
	}
	archives, catalog, err := s.flycastArchives(input, config, coreID, resolved)
	if err != nil {
		return err
	}
	machine, err := rules.FlycastMachineFor(resolved.Target.ContentRequirements.Platform, file, catalog, true)
	if err != nil {
		return fmt.Errorf("flycast machine for: %w", err)
	}
	media, err := rules.FlycastMedia(machine, file, input.Files)
	if err != nil {
		return fmt.Errorf("flycast media: %w", err)
	}
	for _, key := range media.MediaFiles {
		if err := validateCHD(input, key); err != nil {
			return err
		}
	}
	prepared.Archives, prepared.FlycastCatalog, prepared.FlycastLoaded = archives, catalog, true
	return nil
}

func (s *Service) flycastArchives(input *request, config *rules.Configuration, coreID string,
	resolved *rules.Resolved,
) (map[string][]rules.ArchiveMember, []rules.FlycastMachine, error) {
	keys := append([]string{*config.Content.EntryFile}, config.Core(coreID).Parents()...)
	if input.AttachFile != nil && strings.HasSuffix(rules.Lower(*input.AttachFile), ".zip") {
		keys = append(keys, *input.AttachFile)
	}
	archives := map[string][]rules.ArchiveMember{}
	for _, key := range keys {
		if _, done := archives[key]; done {
			continue
		}
		if file := rules.FindFile(input.Files, key); file != nil {
			members, err := input.members(file)
			if err != nil {
				return nil, nil, err
			}
			archives[key] = members
		}
	}
	catalog, err := s.flycastTable(input.ProviderRoots[resolved.Binding.ProviderID], resolved.Target.ContentRequirements)
	if err != nil {
		return nil, nil, err
	}
	return archives, catalog, nil
}

func validateCHD(input *request, key string) error {
	file := rules.FindFile(input.Files, key)
	if file == nil {
		return rules.Fail("RUNTIME_FLYCAST_DISC_MISSING")
	}
	header, err := readHeader(input, file, 124)
	if err != nil {
		return err
	}
	version := uint32(0)
	if len(header) >= 16 {
		version = binary.BigEndian.Uint32(header[12:])
	}
	minimum := map[uint32]int{3: 120, 4: 108, 5: 124}[version]
	if minimum == 0 || len(header) < minimum || string(header[:8]) != "MComprHD" ||
		binary.BigEndian.Uint32(header[8:]) != uint32(minimum) {
		return rules.Fail("RUNTIME_FLYCAST_DISC_INVALID")
	}
	return nil
}

// readHeader reads up to length bytes of a file whose logical size matches its facts.
func readHeader(input *request, file *rules.File, length int64) ([]byte, error) {
	locator, err := input.locator(file)
	if err != nil {
		return nil, err
	}
	handle, err := content.Open(locator)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer func() { _ = handle.Close() }()
	if handle.Size() != file.Size() {
		return nil, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	buffer := make([]byte, length)
	read, err := handle.ReadAt(buffer, 0)
	if err != nil {
		return nil, fmt.Errorf("read at: %w", err)
	}
	return buffer[:read], nil
}

type flycastKey struct{ root, core, catalog string }

var (
	flycastMutex  sync.Mutex
	flycastTables = map[flycastKey][]rules.FlycastMachine{}
)

var flycastToken = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

func (s *Service) flycastTable(root string, requirement *rules.ContentRequirements) ([]rules.FlycastMachine, error) {
	if !strings.HasPrefix(root, "/") || requirement.Core == nil || requirement.Catalog == nil {
		return nil, rules.Fail("RUNTIME_FLYCAST_CATALOG_UNAVAILABLE")
	}
	key := flycastKey{root, requirement.Core.SHA256, requirement.Catalog.SHA256}
	flycastMutex.Lock()
	defer flycastMutex.Unlock()
	if table, exists := flycastTables[key]; exists {
		return table, nil
	}
	table, err := loadFlycastTable(root, requirement)
	if err != nil {
		return nil, err
	}
	flycastTables[key] = table
	return table, nil
}

func readProviderAsset(root string, reference *rules.AssetReference, maximum int64) ([]byte, error) {
	invalid := rules.Fail("RUNTIME_FLYCAST_CATALOG_INVALID")
	file, err := os.OpenFile(filepath.Join(root, reference.Path), os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, fmt.Errorf("flycast catalog: %w", err)
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maximum {
		return nil, invalid
	}
	data := make([]byte, info.Size())
	if _, err := file.ReadAt(data, 0); err != nil {
		return nil, invalid
	}
	if content.SHA256(data) != reference.SHA256 {
		return nil, invalid
	}
	return data, nil
}

func loadFlycastTable(root string, requirement *rules.ContentRequirements) ([]rules.FlycastMachine, error) {
	invalid := rules.Fail("RUNTIME_FLYCAST_CATALOG_INVALID")
	// The selected Provider's ROM facts must belong to the exact core used for this Target.
	if _, err := readProviderAsset(root, requirement.Core, 32*1024*1024); err != nil {
		return nil, err
	}
	data, err := readProviderAsset(root, requirement.Catalog, 4*1024*1024)
	if err != nil {
		return nil, err
	}
	var document struct {
		SchemaVersion int    `json:"schemaVersion"`
		Kind          string `json:"kind"`
		Core          *struct {
			SHA256   string `json:"sha256"`
			Filename string `json:"filename"`
		} `json:"core"`
		Machines []rules.FlycastMachine `json:"machines"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, invalid
	}
	if document.SchemaVersion != 1 || document.Kind != "FLYCAST_ROM_REQUIREMENTS" || document.Core == nil ||
		document.Core.SHA256 != requirement.Core.SHA256 || document.Core.Filename != rules.BaseName(requirement.Core.Path) {
		return nil, invalid
	}
	if document.Machines == nil || len(document.Machines) > 10000 || !validFlycastMachines(document.Machines) {
		return nil, invalid
	}
	return document.Machines, nil
}

var crcPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}$`)

func validFlycastMachines(machines []rules.FlycastMachine) bool {
	for _, machine := range machines {
		for _, reference := range []*string{machine.Parent, machine.Disc} {
			if reference != nil && (!flycastToken.MatchString(*reference) || strings.Contains(*reference, "..")) {
				return false
			}
		}
		if machine.Files == nil {
			return false
		}
		for _, file := range machine.Files {
			if file.SizeBytes < 0 || file.SizeBytes != float64(int64(file.SizeBytes)) ||
				file.CRC32 != nil && !crcPattern.MatchString(*file.CRC32) {
				return false
			}
		}
	}
	return true
}

func (s *Service) mameMedia(input *request, coreID string) (map[string]rules.CHDHeader, error) {
	headers := map[string]rules.CHDHeader{}
	if coreID != "mame_arcade" {
		return headers, nil
	}
	for index := range input.Files {
		file := &input.Files[index]
		if !rules.HasSuffixFold(file.LogicalKey, ".chd") {
			continue
		}
		header, err := readHeader(input, file, 124)
		if err != nil {
			return nil, err
		}
		parsed, err := rules.ParseCHDHeader(header, file.Size())
		if err != nil {
			return nil, fmt.Errorf("parse chd header: %w", err)
		}
		headers[file.LogicalKey] = *parsed
	}
	return headers, nil
}

func (s *Service) firmwareEvidence(ctx context.Context, input *request, prepared *rules.PrepareRequest,
	config *rules.Configuration, coreID string,
) error {
	if coreID != "mednafen_psx_hw" || config.Content.Kind != "SINGLE_FILE" {
		return nil
	}
	entry := *config.Content.EntryFile
	if strings.HasSuffix(rules.Lower(entry), ".cue") && !prepared.CueKnown {
		cue, err := s.cueFiles(ctx, input, entry)
		if err != nil {
			return err
		}
		prepared.CueFiles, prepared.CueKnown = cue, true
	}
	evidence := &rules.FirmwareEvidence{}
	if key := psxImageKey(prepared, entry); key != "" {
		region, err := psxRegion(input, key)
		if err != nil {
			return err
		}
		evidence.PSXRegion = region
	}
	prepared.Evidence = evidence
	return nil
}

var psxImage = regexp.MustCompile(`(?i)\.(?:bin|iso|img)$`)

// psxImageKey is the raw disc image to inspect: the entry itself or the first file of its CUE sheet, or "".
func psxImageKey(prepared *rules.PrepareRequest, entry string) string {
	key := entry
	if strings.HasSuffix(rules.Lower(entry), ".cue") {
		key = ""
		if len(prepared.CueFiles) > 0 {
			key = prepared.CueFiles[0]
		}
	}
	if !psxImage.MatchString(key) {
		return ""
	}
	return key
}

// psxRegion inspects only the disc system area; the managed store already verified the whole-file SHA.
func psxRegion(input *request, key string) (*string, error) {
	file := rules.FindFile(input.Files, key)
	if file == nil {
		return nil, rules.Fail("RUNTIME_ENTRY_MISSING")
	}
	length := min(file.Size(), 5*2352)
	header, err := readHeader(input, file, length)
	if err != nil {
		return nil, err
	}
	if int64(len(header)) != length {
		return nil, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	return rules.IdentifyPSXRegion(header), nil
}

func (s *Service) cueFiles(ctx context.Context, input *request, entry string) ([]string, error) {
	references, err := cueReferences(ctx, input, rules.FindFile(input.Files, entry))
	if err != nil {
		return nil, err
	}
	result := []string{}
	for _, reference := range references {
		var matches []string
		for _, file := range input.Files {
			if rules.Lower(file.LogicalKey) == rules.Lower(reference.LogicalKey) {
				matches = append(matches, file.LogicalKey)
			}
		}
		if len(matches) != 1 {
			return nil, rules.Fail("RUNTIME_CUE_TRACK_MISSING")
		}
		if !containsString(result, matches[0]) {
			result = append(result, matches[0])
		}
	}
	return result, nil
}

func cueReferences(_ context.Context, input *request, file *rules.File) ([]rules.ContentReference, error) {
	if file == nil || file.SizeBytes > 1024*1024 {
		return nil, rules.Fail("RUNTIME_CUE_INVALID")
	}
	locator, err := input.locator(file)
	if err != nil {
		return nil, err
	}
	handle, err := content.Open(locator)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer func() { _ = handle.Close() }()
	data, err := content.ReadVerified(handle, file)
	if err != nil {
		return nil, fmt.Errorf("read verified: %w", err)
	}
	keys := make([]string, len(input.Files))
	for index := range input.Files {
		keys[index] = input.Files[index].LogicalKey
	}
	result, err := rules.CueContentReferences(data, file.LogicalKey, keys)
	if err != nil {
		return nil, fmt.Errorf("cue references: %w", err)
	}
	return result, nil
}

func memberNames(members []rules.ArchiveMember) []string {
	names := make([]string, len(members))
	for index, member := range members {
		names[index] = member.Name
	}
	return names
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// runtimeCode keeps stable runtime reason codes and maps any other failure to unavailable content.
func runtimeCode(err error) error {
	var failure *rules.Failure
	if errors.As(err, &failure) && strings.HasPrefix(failure.Code, "RUNTIME_") {
		return failure
	}
	return rules.Fail("RUNTIME_CONTENT_UNAVAILABLE")
}

// readLocated reads up to length bytes from the start of a located file.
func readLocated(locator *content.Locator, length int64) ([]byte, error) {
	handle, err := content.Open(locator)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	defer func() { _ = handle.Close() }()
	buffer := make([]byte, length)
	read, err := handle.ReadAt(buffer, 0)
	if err != nil {
		return nil, fmt.Errorf("read at: %w", err)
	}
	return buffer[:read], nil
}
