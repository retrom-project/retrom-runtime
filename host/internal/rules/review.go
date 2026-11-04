package rules

import (
	"regexp"
	"sort"
	"strings"
)

// ContentBIOS is the review eligibility projection of required firmware and audit facts.
type ContentBIOS struct {
	BIOSRequirements  []BIOSRequirement  `json:"biosRequirements"`
	CRCWarnings       []CRCWarning       `json:"crcWarnings"`
	MissingROMMembers []MissingROMMember `json:"missingRomMembers"`
}

// reviewInput parses the configuration, selects the core and validates the content tree.
func reviewInput(request *PrepareRequest) (*Configuration, string, error) {
	config, err := ParseConfiguration(request.Config)
	if err != nil {
		return nil, "", err
	}
	coreID, err := SelectedCore(&request.Directory, request.CoreID)
	if err != nil {
		return nil, "", err
	}
	if _, err := ContentHash(request.Files, "TREE"); err != nil {
		return nil, "", err
	}
	return config, coreID, nil
}

// contentCRCWarnings requires complete Flycast cartridges, or reports arcade CRC mismatches from archive evidence.
func contentCRCWarnings(request *PrepareRequest, config *Configuration, coreID string, resolved *Resolved,
	hasEntry bool,
) ([]CRCWarning, error) {
	requirements := resolved.Target.ContentRequirements
	switch {
	case requirements != nil && requirements.Kind == "FLYCAST_CARTRIDGE" && hasEntry:
		flycast, err := FlycastDependencies(requirements.Platform, coreID, config, request.Files, request.FlycastCatalog,
			request.FlycastLoaded, request.Archives)
		if err != nil {
			return nil, err
		}
		if err := RequireFlycast(flycast); err != nil {
			return nil, err
		}
		return flycast.CRCWarnings, nil
	case request.ArcadeCatalog != nil && request.Archives != nil:
		return ArcadeCRCWarnings(coreID, config, request.Files, request.Archives, request.ArcadeCatalog)
	}
	return []CRCWarning{}, nil
}

// ContentBIOSRequirements inspects required content without changing launch preparation.
func (f *Facts) ContentBIOSRequirements(request *PrepareRequest) (*ContentBIOS, error) {
	config, coreID, err := reviewInput(request)
	if err != nil {
		return nil, err
	}
	if config.Content.Kind == "RPG_MAKER_PROJECT" {
		if err := ValidateConfigurationFiles(config, request.Files); err != nil {
			return nil, err
		}
	}
	entry, hasEntry := config.Content.Entry()
	if hasEntry && FindFile(request.Files, entry) == nil {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	resolved, err := f.ResolveTarget(request.Directory.PlatformID, coreID, &config.Content)
	if err != nil {
		return nil, err
	}
	result := &ContentBIOS{CRCWarnings: []CRCWarning{}, MissingROMMembers: []MissingROMMember{}}
	biosSets := []string{}
	if config.Content.Kind == "ARCADE" {
		sets, missing, err := f.arcadeReview(request, config, coreID)
		if err != nil {
			return nil, err
		}
		biosSets, result.MissingROMMembers = sets, missing
	}
	if result.CRCWarnings, err = contentCRCWarnings(request, config, coreID, resolved, hasEntry); err != nil {
		return nil, err
	}
	bios, err := f.ResolveBIOSRequirements(&BIOSRequest{
		ProviderID: resolved.Binding.ProviderID,
		TargetID:   resolved.Binding.TargetID, Config: config, Files: request.Files, Evidence: request.Evidence,
	})
	if err != nil {
		return nil, err
	}
	if request.ArcadeCatalog != nil {
		bios = append(bios, f.ArcadeBIOSRequirements(coreID, request.ArcadeCatalog, biosSets, true)...)
	}
	result.BIOSRequirements = bios
	return result, nil
}

func (f *Facts) arcadeReview(request *PrepareRequest, config *Configuration, coreID string,
) ([]string, []MissingROMMember, error) {
	if request.ArcadeCatalog == nil || request.Archives == nil {
		return nil, nil, Fail("RUNTIME_ARCADE_CATALOG_UNAVAILABLE")
	}
	dependencies, err := Dependencies(coreID, config, request.Files, request.Archives, request.ArcadeCatalog,
		f.Provenance)
	if err != nil {
		return nil, nil, err
	}
	media, err := ArcadeMedia(coreID, config, request.Files, request.ArcadeCatalog, request.CHDHeaders)
	if err != nil {
		return nil, nil, err
	}
	if err := RequireArcadeMedia(media); err != nil {
		return nil, nil, err
	}
	missing, err := ArcadeMissingROMMembers(coreID, config, request.Files, request.Archives, request.ArcadeCatalog)
	if err != nil {
		return nil, nil, err
	}
	if len(dependencies.MissingParents) > 0 && len(missing) == 0 {
		return nil, nil, Fail("RUNTIME_PARENT_MISSING")
	}
	return dependencies.BIOSSets, missing, nil
}

// ParentOptions is the Parent/media projection for a review editor.
type ParentOptions struct {
	CoreID         string         `json:"coreId"`
	ParentFiles    []string       `json:"parentFiles"`
	MissingParents []string       `json:"missingParents"`
	MediaFiles     []string       `json:"mediaFiles"`
	MissingMedia   []string       `json:"missingMedia"`
	Config         *Configuration `json:"config"`
}

func zipNames(parents []string) []string {
	names := make([]string, len(parents))
	for index, parent := range parents {
		names[index] = parent + ".zip"
	}
	return names
}

// attachArcade validates an attached CHD as known media, or adds an attached archive as a parent.
func attachArcade(request *PrepareRequest, config *Configuration, coreID string, media *Media, attachFile *string,
) (*Configuration, error) {
	if attachFile == nil {
		return config, nil
	}
	if HasSuffixFold(*attachFile, ".chd") {
		if !contains(media.MediaFiles, *attachFile) {
			return nil, Fail("RUNTIME_ARCADE_DISK_INVALID")
		}
		return config, nil
	}
	return attachParent(request, config, coreID, *attachFile)
}

// ArcadeParentOptions shares DAT/member rules for Parent facts and an attachment without preparing a launch.
func (f *Facts) ArcadeParentOptions(request *PrepareRequest, attachFile *string) (*ParentOptions, error) {
	config, coreID, err := reviewInput(request)
	if err != nil {
		return nil, err
	}
	resolved, err := f.ResolveTarget(request.Directory.PlatformID, coreID, &config.Content)
	if err != nil {
		return nil, err
	}
	if requirements := resolved.Target.ContentRequirements; requirements != nil &&
		requirements.Kind == "FLYCAST_CARTRIDGE" {
		return f.flycastParentOptions(request, config, coreID, requirements.Platform, attachFile)
	}
	if config.Content.Kind != "ARCADE" {
		return nil, Invalid()
	}
	if request.ArcadeCatalog == nil || request.Archives == nil {
		return nil, Fail("RUNTIME_ARCADE_CATALOG_UNAVAILABLE")
	}
	media, err := ArcadeMedia(coreID, config, request.Files, request.ArcadeCatalog, request.CHDHeaders)
	if err != nil {
		return nil, err
	}
	if config, err = attachArcade(request, config, coreID, media, attachFile); err != nil {
		return nil, err
	}
	dependencies, err := Dependencies(coreID, config, request.Files, request.Archives, request.ArcadeCatalog,
		f.Provenance)
	if err != nil {
		return nil, err
	}
	return &ParentOptions{
		CoreID: coreID, ParentFiles: dependencies.ParentFiles,
		MissingParents: zipNames(dependencies.MissingParents), MediaFiles: media.MediaFiles,
		MissingMedia: media.MissingMedia, Config: config,
	}, nil
}

func (f *Facts) flycastParentOptions(request *PrepareRequest, config *Configuration, coreID, platform string,
	attachFile *string,
) (*ParentOptions, error) {
	if attachFile != nil {
		attached, err := FlycastAttachment(platform, coreID, config, request.Files, request.FlycastCatalog,
			request.FlycastLoaded, *attachFile)
		if err != nil {
			return nil, err
		}
		if config, err = ParseConfiguration(configValue(attached)); err != nil {
			return nil, err
		}
	}
	dependencies, err := FlycastDependencies(platform, coreID, config, request.Files, request.FlycastCatalog,
		request.FlycastLoaded, request.Archives)
	if err != nil {
		return nil, err
	}
	return &ParentOptions{
		CoreID: coreID, ParentFiles: dependencies.ParentFiles,
		MissingParents: zipNames(dependencies.MissingParents), MediaFiles: dependencies.MediaFiles,
		MissingMedia: dependencies.MissingMedia, Config: config,
	}, nil
}

func attachParent(request *PrepareRequest, config *Configuration, coreID, attachFile string) (*Configuration, error) {
	parentID, err := parentReferenceID(request, config, coreID, attachFile)
	if err != nil {
		return nil, err
	}
	next := config.Clone()
	core := ensureCore(next, coreID)
	parents := []string{}
	for _, key := range core.Parents() {
		name := key
		if file := FindFile(request.Files, key); file != nil {
			name = file.Name
		}
		if ArchiveID(name) != parentID {
			parents = append(parents, key)
		}
	}
	parents = append(parents, attachFile)
	core.ParentFiles = &parents
	return ParseConfiguration(configValue(next))
}

func parentReferenceID(request *PrepareRequest, config *Configuration, coreID, attachFile string) (string, error) {
	entry, candidate := FindFile(request.Files, *config.Content.EntryFile), FindFile(request.Files, attachFile)
	if entry == nil || candidate == nil || candidate.LogicalKey == entry.LogicalKey ||
		!HasSuffixFold(candidate.Name, ".zip") {
		return "", Fail("RUNTIME_PARENT_INVALID")
	}
	machineID := ConfiguredMachine(coreID, config, entry.Name)
	parentID, seen := ArchiveID(candidate.Name), map[string]bool{machineID: true}
	for current := request.ArcadeCatalog.Machine(machineID); current.ParentID() != ""; {
		id := current.ParentID()
		if seen[id] || len(seen) > 32 {
			return "", Fail("RUNTIME_ARCADE_CATALOG_INVALID")
		}
		seen[id] = true
		current = request.ArcadeCatalog.Machine(id)
		if id == parentID && current != nil && !current.BIOS {
			return parentID, nil
		}
	}
	return "", Fail("RUNTIME_PARENT_INVALID")
}

// ROMSetRequest is a bounded ROM-set search.
type ROMSetRequest struct {
	PrepareRequest
	Query     *string  `json:"query"`
	Offset    *float64 `json:"offset"`
	Limit     *float64 `json:"limit"`
	EntryFile *string  `json:"entryFile"`
	ROMSet    *string  `json:"romSet"`
}

// ROMSetEntry is one searchable machine.
type ROMSetEntry struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	Year         string `json:"year"`
	Manufacturer string `json:"manufacturer"`
}

func romSetEntry(name string, machine *ArcadeMachine) ROMSetEntry {
	entry := ROMSetEntry{Name: name, Description: name}
	if machine.Description != nil {
		entry.Description = *machine.Description
	}
	if machine.Year != nil {
		entry.Year = *machine.Year
	}
	if machine.Manufacturer != nil {
		entry.Manufacturer = *machine.Manufacturer
	}
	return entry
}

func draftConfiguration(request *ROMSetRequest, coreID string) (*Configuration, error) {
	config, err := ParseConfiguration(request.Config)
	if err != nil {
		return nil, err
	}
	if request.EntryFile != nil {
		value, content, err := configObject(config)
		if err != nil {
			return nil, err
		}
		content["entryFile"] = *request.EntryFile
		if config, err = ParseConfiguration(value); err != nil {
			return nil, err
		}
	}
	if request.ROMSet != nil {
		next := config.Clone()
		core := ensureCore(next, coreID)
		if *request.ROMSet != "" {
			core.ROMSet = request.ROMSet
		} else {
			core.ROMSet = nil
		}
		if config, err = ParseConfiguration(configValue(next)); err != nil {
			return nil, err
		}
	}
	return config, nil
}

// romSetSelection reports the playable automatic machine and the effective selected entry, each possibly null.
func romSetSelection(core *CoreConfiguration, catalog *ArcadeCatalog, automatic string) (any, any) {
	var automaticSelection any
	if Playable(catalog.Machine(automatic)) {
		automaticSelection = automatic
	}
	name := automatic
	if core != nil && core.ROMSet != nil {
		name = *core.ROMSet
	} else if automaticSelection == nil {
		name = ""
	}
	var selected any
	if machine := catalog.Machine(name); name != "" && Playable(machine) {
		selected = romSetEntry(name, machine)
	}
	return automaticSelection, selected
}

// ROMSetOptions is one bounded search projection for every Target declaring a paired DAT.
func (f *Facts) ROMSetOptions(request *ROMSetRequest, catalog *ArcadeCatalog) (map[string]any, error) {
	coreID, err := SelectedCore(&request.Directory, request.CoreID)
	if err != nil {
		return nil, err
	}
	config, err := draftConfiguration(request, coreID)
	if err != nil {
		return nil, err
	}
	if _, err := ContentHash(request.Files, "TREE"); err != nil {
		return nil, err
	}
	resolved, err := f.ResolveTarget(request.Directory.PlatformID, coreID, &config.Content)
	if err != nil {
		return nil, err
	}
	if config.Content.Kind != "ARCADE" || resolved.Target.ROMSetSelection == nil {
		return nil, Fail("RUNTIME_ROM_SET_UNAVAILABLE")
	}
	file := FindFile(request.Files, *config.Content.EntryFile)
	if file == nil {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	query, offset, limit, err := searchPage(request)
	if err != nil {
		return nil, err
	}
	if catalog == nil {
		catalog = &ArcadeCatalog{Machines: map[string]*ArcadeMachine{}}
	}
	entries := searchEntries(catalog, query)
	automaticSelection, selected := romSetSelection(config.Core(coreID), catalog, ArchiveID(file.Name))
	page := []ROMSetEntry{}
	for index := offset; index < len(entries) && index < offset+limit; index++ {
		page = append(page, romSetEntry(entries[index], catalog.Machines[entries[index]]))
	}
	return map[string]any{
		"coreId": coreID, "datSHA256": resolved.Target.ROMSetSelection.DatSHA256,
		"automaticSelection": automaticSelection, "selected": selected, "entries": page, "total": len(entries),
		"offset": offset, "limit": limit,
	}, nil
}

func searchPage(request *ROMSetRequest) (string, int, int, error) {
	query := ""
	if request.Query != nil {
		query = Lower(strings.TrimSpace(*request.Query))
	}
	offset, limit := 0.0, 50.0
	if request.Offset != nil {
		offset = *request.Offset
	}
	if request.Limit != nil {
		limit = *request.Limit
	}
	if UTF16Length(query) > 128 || !safeInteger(offset) || offset < 0 || !safeInteger(limit) || limit < 1 || limit > 100 {
		return "", 0, 0, Invalid()
	}
	return query, int(offset), int(limit), nil
}

func searchEntries(catalog *ArcadeCatalog, query string) []string {
	var names []string
	for _, name := range catalog.Names {
		machine := catalog.Machines[name]
		if !Playable(machine) {
			continue
		}
		texts := []*string{&name, machine.Description, machine.Year, machine.Manufacturer}
		for _, text := range texts {
			if text != nil && strings.Contains(Lower(*text), query) {
				names = append(names, name)
				break
			}
		}
	}
	sort.SliceStable(names, func(i, j int) bool { return UTF8Compare(names[i], names[j]) < 0 })
	return names
}

// ReconcileRequest prunes obsolete Parent references after a configuration edit.
type ReconcileRequest struct {
	Directory      Directory                   `json:"directory"`
	Config         any                         `json:"config"`
	Files          []File                      `json:"files"`
	PreviousConfig any                         `json:"previousConfig"`
	ArcadeCatalogs map[string]*ArcadeCatalog   `json:"-"`
	FlycastTables  map[string][]FlycastMachine `json:"-"`
}

// Reconcile prunes obsolete Parent references while preserving selections and shared files of other cores.
func (f *Facts) Reconcile(request *ReconcileRequest) (map[string]any, error) {
	config, err := ParseConfiguration(request.Config)
	if err != nil {
		return nil, err
	}
	if err := ValidateConfigurationFiles(config, request.Files); err != nil {
		return nil, err
	}
	entryFile, hasEntry := config.Content.Entry()
	if !hasEntry {
		return map[string]any{"config": config, "removedParentFiles": []string{}}, nil
	}
	file := FindFile(request.Files, entryFile)
	for _, coreID := range config.CoreIDs() {
		if err := f.reconcileCore(request, config, coreID, file); err != nil {
			return nil, err
		}
	}
	retained := map[string]bool{entryFile: true}
	for _, coreID := range config.CoreIDs() {
		for _, key := range config.Core(coreID).Parents() {
			retained[key] = true
		}
	}
	previous := config
	if request.PreviousConfig != nil {
		if previous, err = ParseConfiguration(request.PreviousConfig); err != nil {
			return nil, err
		}
	}
	removed := []string{}
	for _, coreID := range previous.CoreIDs() {
		for _, key := range previous.Core(coreID).Parents() {
			if !retained[key] && !contains(removed, key) {
				removed = append(removed, key)
			}
		}
	}
	return map[string]any{"config": config, "removedParentFiles": removed}, nil
}

// parentMachines are the non-BIOS ancestors of a playable machine.
func parentMachines(catalog *ArcadeCatalog, name string) (map[string]bool, error) {
	ancestors := map[string]bool{}
	if !Playable(catalog.Machine(name)) {
		return ancestors, nil
	}
	tree, err := arcadeAncestry(name, catalog)
	if err != nil {
		return nil, err
	}
	for _, parent := range tree.Parents[1:] {
		if !parent.Machine.BIOS {
			ancestors[parent.ID] = true
		}
	}
	return ancestors, nil
}

func (f *Facts) reconcileCore(request *ReconcileRequest, config *Configuration, coreID string, file *File) error {
	core := config.Core(coreID)
	resolved, err := f.ResolveTarget(request.Directory.PlatformID, coreID, &config.Content)
	if err != nil {
		return err
	}
	if requirements := resolved.Target.ContentRequirements; requirements != nil &&
		requirements.Kind == "FLYCAST_CARTRIDGE" {
		pruneFlycastParents(core, file, request.Files, request.FlycastTables[coreID])
		return nil
	}
	catalog := request.ArcadeCatalogs[coreID]
	if core.ROMSet != nil && (resolved.Target.ROMSetSelection == nil || !Playable(catalog.Machine(*core.ROMSet))) {
		return Fail("RUNTIME_ROM_SET_INVALID", "coreId", coreID)
	}
	if catalog == nil {
		return nil
	}
	ancestors, err := parentMachines(catalog, ConfiguredMachine(coreID, config, file.Name))
	if err != nil {
		return err
	}
	if core.ParentFiles != nil {
		kept := []string{}
		for _, key := range *core.ParentFiles {
			if parent := FindFile(request.Files, key); parent != nil && ancestors[ArchiveID(parent.Name)] {
				kept = append(kept, key)
			}
		}
		core.ParentFiles = &kept
	}
	return nil
}

func pruneFlycastParents(core *CoreConfiguration, file *File, files []File, catalog []FlycastMachine) {
	name := ArchiveID(file.Name)
	parent, known := "", false
	for index := range catalog {
		if catalog[index].Name == name {
			if catalog[index].Parent != nil {
				parent, known = *catalog[index].Parent, true
			}
			break
		}
	}
	if core.ParentFiles == nil {
		return
	}
	kept := []string{}
	for _, key := range *core.ParentFiles {
		candidate := FindFile(files, key)
		if candidate == nil || !known || !HasSuffixFold(candidate.Name, ".zip") {
			continue
		}
		if base := BaseName(candidate.Name); Lower(base[:len(base)-4]) == parent {
			kept = append(kept, key)
		}
	}
	core.ParentFiles = &kept
}

var dosProgram = regexp.MustCompile(`(?i)\.(?:exe|com|bat)$`)

// DOSEntryCandidates lists program members of a DOS archive.
func DOSEntryCandidates(entries []string) []string {
	result := []string{}
	for _, name := range entries {
		if dosProgram.MatchString(name) && LogicalPath(name, false) && !contains(result, name) {
			result = append(result, name)
		}
	}
	sortUTF8(result)
	return result
}

// RPGEntryCandidates is the read-only editor projection, including an unsaved engine choice.
func RPGEntryCandidates(configValueInput any, files []File, engine *string) ([]string, error) {
	config, err := ParseConfiguration(configValueInput)
	if err != nil {
		return nil, err
	}
	if config.Content.Kind != "RPG_MAKER_PROJECT" {
		return nil, Invalid()
	}
	if engine != nil {
		value, content, err := configObject(config)
		if err != nil {
			return nil, err
		}
		content["engine"] = *engine
		if config, err = ParseConfiguration(value); err != nil {
			return nil, err
		}
	}
	if _, err := ContentHash(files, "TREE"); err != nil {
		return nil, err
	}
	return RPGEntryFiles(*config.Content.Engine, files), nil
}
