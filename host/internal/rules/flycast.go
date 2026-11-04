package rules

import (
	"regexp"
	"strings"
)

// FlycastFile is one cartridge member expected by the compiled core table.
type FlycastFile struct {
	Name      string  `json:"name"`
	SizeBytes float64 `json:"sizeBytes"`
	CRC32     *string `json:"crc32"`
	Optional  bool    `json:"optional"`
}

// FlycastMachine is one machine of the selected compiled core's table.
type FlycastMachine struct {
	Name      string        `json:"name"`
	Parent    *string       `json:"parent"`
	Platform  string        `json:"platform"`
	MediaType string        `json:"mediaType"`
	Disc      *string       `json:"disc"`
	Files     []FlycastFile `json:"files"`
}

var flycastName = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// FlycastMachineFor interprets only the table emitted by the selected compiled core.
func FlycastMachineFor(platform string, file *File, catalog []FlycastMachine, loaded bool) (*FlycastMachine, error) {
	if !loaded {
		return nil, Fail("RUNTIME_FLYCAST_CATALOG_UNAVAILABLE")
	}
	name := ArchiveID(file.Name)
	if !flycastName.MatchString(name) || !HasSuffixFold(file.Name, ".zip") || strings.Contains(name, "..") {
		return nil, Fail("RUNTIME_FLYCAST_MEDIA_UNSUPPORTED")
	}
	var matches []*FlycastMachine
	for index := range catalog {
		if catalog[index].Name == name {
			matches = append(matches, &catalog[index])
		}
	}
	if len(matches) != 1 {
		return nil, Fail("RUNTIME_FLYCAST_MACHINE_UNKNOWN", "machine", name)
	}
	machine := matches[0]
	if machine.Platform != platform {
		return nil, Fail("RUNTIME_FLYCAST_PLATFORM_MISMATCH", "machine", name)
	}
	disc := optionalString(machine.Disc)
	cartridge := machine.MediaType == "CARTRIDGE" && machine.Disc == nil
	gdrom := machine.MediaType == "GDROM" && disc != "" && LogicalPath(disc, false) && !strings.Contains(disc, "/")
	if !cartridge && !gdrom {
		return nil, Fail("RUNTIME_FLYCAST_MEDIA_UNSUPPORTED", "machine", name)
	}
	return machine, nil
}

// FlycastResult is the dependency analysis of one Flycast cartridge.
type FlycastResult struct {
	Machine        *FlycastMachine
	ParentFiles    []string
	MissingParents []string
	MissingROMs    []string
	CRCWarnings    []CRCWarning
	Media
}

// flycastParents selects the configured parent archive of the machine; at most one, all of them matching.
func flycastParents(files []File, selected []string, machine *FlycastMachine) ([]*File, error) {
	var parents []*File
	for index := range files {
		if contains(selected, files[index].LogicalKey) && ArchiveID(files[index].Name) == optionalString(machine.Parent) &&
			machine.Parent != nil {
			parents = append(parents, &files[index])
		}
	}
	if len(parents) > 1 || !allSelected(selected, parents) {
		return nil, Fail("RUNTIME_PARENT_INVALID")
	}
	return parents, nil
}

// flycastMissing lists absent required ROMs; inherited reports a ROM that only the parent machine can supply.
func flycastMissing(machine, parent *FlycastMachine, available []ArchiveMember) ([]string, bool) {
	var missing []string
	inherited := false
	for index := range machine.Files {
		expected := &machine.Files[index]
		if expected.Optional || findFlycastMember(available, expected) != nil {
			continue
		}
		if parent != nil && parentHasMember(parent, expected) {
			inherited = true
		} else {
			missing = append(missing, expected.Name)
		}
	}
	return missing, inherited
}

// FlycastDependencies resolves the direct named parent; a complete ZIP needs no parent.
func FlycastDependencies(platform, coreID string, config *Configuration, files []File, catalog []FlycastMachine,
	loaded bool, archives map[string][]ArchiveMember,
) (*FlycastResult, error) {
	entryFile, ok := config.Content.Entry()
	if !ok {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	entry := FindFile(files, entryFile)
	if entry == nil {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	machine, err := FlycastMachineFor(platform, entry, catalog, loaded)
	if err != nil {
		return nil, err
	}
	members, exists := archives[entry.LogicalKey]
	if archives == nil || !exists {
		return nil, Fail("RUNTIME_ARCHIVE_EVIDENCE_REQUIRED")
	}
	parents, err := flycastParents(files, config.Core(coreID).Parents(), machine)
	if err != nil {
		return nil, err
	}
	available := locate(members, entry.LogicalKey)
	for _, parent := range parents {
		available = append(available, locate(archives[parent.LogicalKey], parent.LogicalKey)...)
	}
	result := &FlycastResult{
		Machine: machine, ParentFiles: []string{}, MissingParents: []string{}, MissingROMs: []string{},
		CRCWarnings: []CRCWarning{},
	}
	parentMachine := flycastByName(catalog, optionalString(machine.Parent), machine.Parent != nil)
	missing, inherited := flycastMissing(machine, parentMachine, available)
	result.MissingROMs = append(result.MissingROMs, missing...)
	if inherited && machine.Parent != nil && *machine.Parent != "" {
		result.MissingParents = []string{*machine.Parent}
	}
	result.CRCWarnings = flycastCRCWarnings(machine, available, entry.LogicalKey)
	for _, parent := range parents {
		if suppliesMember(machine, available, parent.LogicalKey) {
			result.ParentFiles = append(result.ParentFiles, parent.LogicalKey)
		}
	}
	media, err := FlycastMedia(machine, entry, files)
	if err != nil {
		return nil, err
	}
	result.Media = *media
	return result, nil
}

func allSelected(selected []string, parents []*File) bool {
	for _, key := range selected {
		found := false
		for _, parent := range parents {
			found = found || parent.LogicalKey == key
		}
		if !found {
			return false
		}
	}
	return true
}

func locate(members []ArchiveMember, file string) []ArchiveMember {
	located := make([]ArchiveMember, len(members))
	for index, member := range members {
		member.File = file
		located[index] = member
	}
	return located
}

func flycastByName(catalog []FlycastMachine, name string, present bool) *FlycastMachine {
	if !present {
		return nil
	}
	for index := range catalog {
		if catalog[index].Name == name {
			return &catalog[index]
		}
	}
	return nil
}

func parentHasMember(parent *FlycastMachine, expected *FlycastFile) bool {
	for index := range parent.Files {
		if sameFlycastMember(expected, &parent.Files[index]) {
			return true
		}
	}
	return false
}

func suppliesMember(machine *FlycastMachine, available []ArchiveMember, parent string) bool {
	for index := range machine.Files {
		if member := findFlycastMember(available, &machine.Files[index]); member != nil && member.File == parent {
			return true
		}
	}
	return false
}

func flycastCRCWarnings(machine *FlycastMachine, available []ArchiveMember, entry string) []CRCWarning {
	warnings := []CRCWarning{}
	for index := range machine.Files {
		expected := &machine.Files[index]
		member := findFlycastMember(available, expected)
		if expected.CRC32 == nil || *expected.CRC32 == "" || member == nil || Lower(*expected.CRC32) == Lower(member.CRC32) {
			continue
		}
		role := "PARENT"
		if member.File == entry {
			role = "ROM"
		}
		warnings = append(warnings, CRCWarning{
			Role: role, File: member.File, Member: member.Name,
			ExpectedCRC32: Lower(*expected.CRC32), ActualCRC32: Lower(member.CRC32),
		})
	}
	return warnings
}

// RequireFlycast fails on missing ROMs, parents or media.
func RequireFlycast(result *FlycastResult) error {
	if len(result.MissingROMs) > 0 {
		return Fail("RUNTIME_FLYCAST_ROM_MISSING", "machine", result.Machine.Name,
			"members", strings.Join(result.MissingROMs, ","))
	}
	if len(result.MissingParents) > 0 {
		return Fail("RUNTIME_PARENT_MISSING", "parents", strings.Join(result.MissingParents, ","))
	}
	if len(result.MissingMedia) > 0 {
		return Fail("RUNTIME_FLYCAST_DISC_MISSING", "files", strings.Join(result.MissingMedia, ","))
	}
	return nil
}

func fileWithKey(files []*File, key string) *File {
	for _, file := range files {
		if file.LogicalKey == key {
			return file
		}
	}
	return nil
}

// FlycastMedia maps the GD-ROM image of a machine.
func FlycastMedia(machine *FlycastMachine, entry *File, files []File) (*Media, error) {
	if machine.Disc == nil || *machine.Disc == "" {
		return emptyMedia(), nil
	}
	disc := *machine.Disc
	expected, root := machine.Name+"/"+disc+".chd", Root(entry.LogicalKey)
	var candidates []*File
	for index := range files {
		file := &files[index]
		if strings.HasPrefix(file.LogicalKey, root) && Lower(BaseName(file.Name)) == disc+".chd" {
			candidates = append(candidates, file)
		}
	}
	exact := fileWithKey(candidates, root+expected)
	if exact == nil && machine.Parent != nil && *machine.Parent != "" {
		exact = fileWithKey(candidates, root+*machine.Parent+"/"+disc+".chd")
	}
	if exact == nil && len(candidates) > 1 {
		return nil, Fail("RUNTIME_FLYCAST_DISC_AMBIGUOUS", "file", expected)
	}
	if exact == nil && len(candidates) == 1 {
		exact = candidates[0]
	}
	if exact == nil {
		return &Media{MediaFiles: []string{}, MissingMedia: []string{expected}, MediaPaths: map[string]string{}}, nil
	}
	return &Media{
		MediaFiles: []string{exact.LogicalKey}, MissingMedia: []string{},
		MediaPaths: map[string]string{exact.LogicalKey: expected},
	}, nil
}

// ContentReference is an advisory dependency discovered beside a source entry.
type ContentReference struct {
	LogicalKey   string `json:"logicalKey"`
	RelativeTo   string `json:"relativeTo"`
	RelativePath string `json:"relativePath"`
	Optional     *bool  `json:"optional,omitempty"`
}

// FlycastContentReferences lists the disc and needed parent beside an entry archive.
func FlycastContentReferences(machine *FlycastMachine, entry *File, members []ArchiveMember,
	catalog []FlycastMachine,
) []ContentReference {
	root := Root(entry.LogicalKey)
	parent := optionalString(machine.Parent)
	var names []string
	if machine.Disc != nil && *machine.Disc != "" {
		names = append(names, machine.Name+"/"+*machine.Disc+".chd")
		if parent != "" {
			names = append(names, parent+"/"+*machine.Disc+".chd")
		}
	}
	parentMachine := flycastByName(catalog, parent, machine.Parent != nil)
	if parent != "" {
		for index := range machine.Files {
			expected := &machine.Files[index]
			if !expected.Optional && findFlycastMember(members, expected) == nil && parentMachine != nil &&
				parentHasMember(parentMachine, expected) {
				names = append(names, parent+".zip")
				break
			}
		}
	}
	optional := true
	references := make([]ContentReference, 0, len(names))
	for _, name := range names {
		references = append(references, ContentReference{
			LogicalKey: root + name, RelativeTo: entry.LogicalKey,
			RelativePath: name, Optional: &optional,
		})
	}
	return references
}

// FlycastAttachment returns the configuration after attaching a parent ZIP or disc.
func FlycastAttachment(platform, coreID string, config *Configuration, files []File, catalog []FlycastMachine,
	loaded bool, attachFile string,
) (*Configuration, error) {
	entryFile, ok := config.Content.Entry()
	if !ok {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	entry, candidate := FindFile(files, entryFile), FindFile(files, attachFile)
	if entry == nil || candidate == nil || candidate.LogicalKey == entry.LogicalKey {
		return nil, Fail("RUNTIME_PARENT_INVALID")
	}
	machine, err := FlycastMachineFor(platform, entry, catalog, loaded)
	if err != nil {
		return nil, err
	}
	if machine.Disc != nil && *machine.Disc != "" && Lower(BaseName(candidate.Name)) == *machine.Disc+".chd" {
		return config, nil
	}
	parent := optionalString(machine.Parent)
	if parent == "" || !HasSuffixFold(candidate.Name, ".zip") || ArchiveID(candidate.Name) != parent {
		return nil, Fail("RUNTIME_PARENT_INVALID")
	}
	next := config.Clone()
	core := ensureCore(next, coreID)
	parents := []string{}
	for _, key := range core.Parents() {
		name := key
		if file := FindFile(files, key); file != nil {
			name = file.Name
		}
		if ArchiveID(name) != parent {
			parents = append(parents, key)
		}
	}
	parents = append(parents, attachFile)
	core.ParentFiles = &parents
	return next, nil
}

func ensureCore(config *Configuration, coreID string) *CoreConfiguration {
	if config.Cores == nil {
		cores := map[string]*CoreConfiguration{}
		config.Cores = &cores
	}
	core := (*config.Cores)[coreID]
	if core == nil {
		core = &CoreConfiguration{}
		(*config.Cores)[coreID] = core
	}
	return core
}

func sameFlycastMember(left, right *FlycastFile) bool {
	return left.SizeBytes == right.SizeBytes && (left.Name == right.Name ||
		left.CRC32 != nil && right.CRC32 != nil && *left.CRC32 == *right.CRC32)
}

func findFlycastMember(members []ArchiveMember, expected *FlycastFile) *ArchiveMember {
	if expected.CRC32 != nil {
		for index := range members {
			if float64(members[index].SizeBytes) == expected.SizeBytes && Lower(members[index].CRC32) == Lower(*expected.CRC32) {
				return &members[index]
			}
		}
	}
	for index := range members {
		if members[index].Name == expected.Name && float64(members[index].SizeBytes) == expected.SizeBytes {
			return &members[index]
		}
	}
	return nil
}
