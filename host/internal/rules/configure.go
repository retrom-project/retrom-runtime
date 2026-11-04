package rules

import (
	"encoding/base64"
	"regexp"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

// ConfigureEvidence is bounded host-read evidence for configuration.
type ConfigureEvidence struct {
	Text         *string `json:"text,omitempty"`
	BytesBase64  *string `json:"bytesBase64,omitempty"`
	PrefixBase64 *string `json:"prefixBase64,omitempty"`
}

// Selection is an explicit administrator choice.
type Selection struct {
	EntryFile *string        `json:"entryFile,omitempty"`
	EntryPath *string        `json:"entryPath,omitempty"`
	ScummVM   map[string]any `json:"scummvm,omitempty"`
}

// ConfigureRequest constructs game-specific rules from immutable file facts.
type ConfigureRequest struct {
	PlatformID     string                       `json:"platformId"`
	CoreIDs        []string                     `json:"coreIds"`
	Files          []File                       `json:"files"`
	Evidence       map[string]ConfigureEvidence `json:"evidence"`
	ArchiveMembers map[string][]string          `json:"archiveMembers"`
	Selection      *Selection                   `json:"selection"`
	ArcadeCatalogs map[string]*ArcadeCatalog    `json:"-"`
	FlycastTables  map[string][]FlycastMachine  `json:"-"`
	FlycastKnown   bool                         `json:"-"`
}

func (r *ConfigureRequest) selectedEntry() string {
	if r.Selection == nil || r.Selection.EntryFile == nil {
		return ""
	}
	return *r.Selection.EntryFile
}

// ONSSampleBytes is the bounded ONS script prefix the host supplies as evidence.
const ONSSampleBytes = 1024 * 1024

// ONSScriptNames are the scripts ScriptHandler::readScript opens, in order.
var ONSScriptNames = []string{"0.txt", "00.txt", "nscr_sec.dat", "nscript.dat"}

// Configure constructs a validated configuration without host storage IDs or installation state.
func (f *Facts) Configure(request *ConfigureRequest) (*Configuration, error) {
	if _, err := ContentHash(request.Files, "TREE"); err != nil {
		return nil, err
	}
	if len(request.CoreIDs) == 0 || !f.coresAvailable(request.PlatformID, request.CoreIDs) {
		return nil, Fail("RUNTIME_CORE_UNAVAILABLE")
	}
	if err := validateEvidence(request); err != nil {
		return nil, err
	}
	content, err := f.constructContent(request)
	if err != nil {
		return nil, err
	}
	cores, present, err := f.configuredCores(request, content)
	if err != nil {
		return nil, err
	}
	_, contentValue, err := configObject(&Configuration{Content: *content})
	if err != nil {
		return nil, err
	}
	value := map[string]any{"content": contentValue}
	if present {
		value["cores"] = cores
	}
	config, err := ParseConfiguration(value)
	if err != nil {
		return nil, err
	}
	if err := f.ValidateConfiguredOptions(request.PlatformID, config, request.Files); err != nil {
		return nil, err
	}
	return config, nil
}

func (f *Facts) coresAvailable(platformID string, cores []string) bool {
	for _, core := range cores {
		found := false
		for index := range f.Bindings {
			found = found || f.Bindings[index].CoreID == core && f.Bindings[index].HasPlatform(platformID)
		}
		if !found {
			return false
		}
	}
	return true
}

// configuredCores derives per-core options from content; present reports whether the configuration has cores.
func (f *Facts) configuredCores(request *ConfigureRequest, content *Content) (map[string]any, bool, error) {
	entry, hasEntry := content.Entry()
	switch {
	case request.PlatformID == "arcade" && content.Kind == "ARCADE":
		cores, err := arcadeConfigureParents(request, entry)
		return cores, len(cores) > 0, err
	case request.FlycastKnown && hasEntry:
		return flycastConfigureParents(request, entry), true, nil
	case request.PlatformID == "scummvm":
		if request.Selection == nil || request.Selection.ScummVM == nil {
			return nil, false, Fail("RUNTIME_SCUMMVM_SELECTION_REQUIRED")
		}
		return map[string]any{"scummvm": map[string]any{"options": cloneObject(request.Selection.ScummVM)}}, true, nil
	case request.PlatformID == "ons" && hasEntry:
		encoding, err := onsScriptEncoding(request.Files, entry, request.Evidence)
		if err != nil {
			return nil, false, err
		}
		options := map[string]any{"scriptEncoding": encoding}
		return map[string]any{"onscripter_yuri": map[string]any{"options": options}}, true, nil
	case request.PlatformID == "siglus" && hasEntry:
		language := siglusLanguage(request.Files, entry)
		return map[string]any{"siglus": map[string]any{"options": map[string]any{"language": language}}}, true, nil
	case content.Kind == "KIRIKIRI_PROJECT":
		return kirikiriConfigureOverlay(request, entry)
	}
	return nil, false, nil
}

// kirikiriConfigureOverlay selects the only resource patch; several patches require an explicit launch choice.
func kirikiriConfigureOverlay(request *ConfigureRequest, entry string) (map[string]any, bool, error) {
	patches, err := discoverPatches(request.Files, textEvidence(request.Evidence), &entry)
	if err != nil {
		return nil, false, err
	}
	if len(patches) > 1 {
		return nil, false, Fail("RUNTIME_LAUNCH_REQUIRED", "candidates", patchCandidates(patches))
	}
	if len(patches) == 0 {
		return nil, false, nil
	}
	options := map[string]any{"overlayRoot": patches[0].optionRoot}
	return map[string]any{"kirikiri2": map[string]any{"options": options}}, true, nil
}

func patchCandidates(patches []patch) string {
	names := make([]string, len(patches))
	for index, item := range patches {
		names[index] = JSONString(item.overlayRoot)
	}
	return "[" + strings.Join(names, ",") + "]"
}

func textEvidence(evidence map[string]ConfigureEvidence) map[string]Evidence {
	result := make(map[string]Evidence, len(evidence))
	for key, record := range evidence {
		result[key] = Evidence{PrefixBase64: record.PrefixBase64, Text: record.Text}
	}
	return result
}

func siglusLanguage(files []File, entry string) string {
	names := siglusNames(files, entry)
	if names["scene.chs"] && names["gameexe.chs"] {
		return "chs"
	}
	return "original"
}

func validateEvidence(request *ConfigureRequest) error {
	for path, evidence := range request.Evidence {
		if FindFile(request.Files, path) == nil ||
			evidence.Text != nil && UTF16Length(*evidence.Text) > 262144 ||
			evidence.BytesBase64 != nil && len(*evidence.BytesBase64) > 32*1024*1024 ||
			evidence.PrefixBase64 != nil && len(*evidence.PrefixBase64) > (ONSSampleBytes+2)/3*4 {
			return Fail("RUNTIME_EVIDENCE_INVALID")
		}
	}
	return nil
}

var (
	onsPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?:^|/)nscript\.dat$`), regexp.MustCompile(`(?:^|/)nscr_sec\.dat$`),
		regexp.MustCompile(`(?:^|/)0\.txt$`), regexp.MustCompile(`(?:^|/)00\.txt$`),
	}
	butterscotchPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?:^|/)data\.win$`), regexp.MustCompile(`(?:^|/)runner\.js$`),
		regexp.MustCompile(`(?:^|/)game\.js$`), regexp.MustCompile(`(?:^|/)data\.js$`),
		regexp.MustCompile(`(?:^|/)index\.html$`),
	}
	tyranoEntry = regexp.MustCompile(`(?:^|/)index\.html$`)
	siglusEntry = regexp.MustCompile(`(?:^|/)scene\.pck$`)
	nxEntry     = regexp.MustCompile(`(?:^|/)doukutsu\.exe$`)
	daphneEntry = regexp.MustCompile(`\.(?:txt|framefile)$`)
	dosArchive  = regexp.MustCompile(`\.(?:zip|dosz)$`)
	mzScript    = regexp.MustCompile(`(?:^|/)js/rmmz_core\.js$`)
	mvScript    = regexp.MustCompile(`(?:^|/)js/rpg_core\.js$`)
	gameINI     = regexp.MustCompile(`(?:^|/)game\.ini$`)
	lcfDatabase = regexp.MustCompile(`(?:^|/)rpg_rt\.ldb$`)
	coreScript  = regexp.MustCompile(`(?i)js/(?:rpg_core|rmmz_core)\.js$`)
	// JavaScript's multiline anchors also match at CR and U+2028/U+2029 line terminators.
	rgssScripts = regexp.MustCompile(`(?i)(?:^|[\n\r\x{2028}\x{2029}])scripts[` + jsSpace +
		`]*=[` + jsSpace + `]*[^\r\n]*\.(rxdata|rvdata2?)(?:$|[\n\r\x{2028}\x{2029}])`)
	rtpHeader = regexp.MustCompile(`^[` + jsSpace + `]*\[([^\]]*)\][` + jsSpace + `]*$`)
	rtpEntry  = regexp.MustCompile(`(?i)^[` + jsSpace + `]*(rtp[123]?)[` + jsSpace + `]*=[` + jsSpace +
		`]*(.*?)[` + jsSpace + `]*$`)
	fileEntryAny = func(string) bool { return true }
)

func entryContent(kind string, file *File) *Content {
	key := file.LogicalKey
	return &Content{Kind: kind, EntryFile: &key}
}

func (f *Facts) constructContent(request *ConfigureRequest) (*Content, error) {
	matching := func(pattern *regexp.Regexp) func(string) bool { return pattern.MatchString }
	var file *File
	var err error
	kind := ""
	switch request.PlatformID {
	case "rpgmaker":
		return rpgContent(request)
	case "scummvm":
		return &Content{Kind: "SCUMMVM_PROJECT"}, nil
	case "dos":
		return dosContent(request)
	case "arcade":
		kind = "ARCADE"
		file, err = arcadeEntry(request)
	case "ons":
		kind = "ONS_PROJECT"
		file, err = choosePreferred(request, onsPatterns)
	case "kirikiri":
		entry, err := KirikiriEntry(request.Files, textEvidence(request.Evidence), request.selectedEntry())
		if err != nil {
			return nil, err
		}
		return &Content{Kind: "KIRIKIRI_PROJECT", EntryFile: &entry}, nil
	case "butterscotch":
		kind = "BUTTERSCOTCH_PROJECT"
		file, err = choosePreferred(request, butterscotchPatterns)
	case "tyranoscript":
		kind = "TYRANOSCRIPT_PROJECT"
		file, err = chooseFile(request, request.Files, matching(tyranoEntry))
	case "siglus":
		kind = "SIGLUS_PROJECT"
		file, err = chooseFile(request, request.Files, matching(siglusEntry))
	case "cavestory":
		kind = "NXENGINE_PROJECT"
		file, err = chooseFile(request, request.Files, matching(nxEntry))
	case "daphne":
		kind = "DAPHNE_PROJECT"
		file, err = chooseFile(request, request.Files, matching(daphneEntry))
	default:
		kind = "SINGLE_FILE"
		file, err = f.singleFileEntry(request)
	}
	if err != nil {
		return nil, err
	}
	return entryContent(kind, file), nil
}

func dosContent(request *ConfigureRequest) (*Content, error) {
	file, err := chooseFile(request, request.Files, dosArchive.MatchString)
	if err != nil {
		return nil, err
	}
	possible := DOSEntryCandidates(request.ArchiveMembers[file.LogicalKey])
	var entryPath *string
	if request.Selection != nil && request.Selection.EntryPath != nil {
		if !LogicalPath(*request.Selection.EntryPath, false) {
			return nil, Fail("RUNTIME_DOS_ENTRY_INVALID")
		}
		entryPath = request.Selection.EntryPath
	} else if len(possible) == 1 {
		entryPath = &possible[0]
	}
	if entryPath != nil && !contains(possible, *entryPath) {
		return nil, Fail("RUNTIME_DOS_ENTRY_INVALID")
	}
	content := entryContent("DOS_BUNDLE", file)
	content.EntryPath = entryPath
	return content, nil
}

func (f *Facts) singleFileEntry(request *ConfigureRequest) (*File, error) {
	extensions := map[string]bool{}
	for _, coreID := range request.CoreIDs {
		declaration, exists := f.ContentFormats[coreID]
		if !exists {
			return nil, Fail("RUNTIME_DECLARATION_INVALID")
		}
		for _, extension := range declaration {
			extensions[extension] = true
		}
	}
	entry := "content"
	for _, coreID := range request.CoreIDs {
		resolved, err := f.ResolveTarget(request.PlatformID, coreID, &Content{Kind: "SINGLE_FILE", EntryFile: &entry})
		if err != nil {
			return nil, err
		}
		if requirements := resolved.Target.ContentRequirements; requirements != nil &&
			requirements.Kind == "FLYCAST_CARTRIDGE" {
			parents := flycastParentNames(request)
			return chooseFile(request, request.Files, func(name string) bool {
				return strings.HasSuffix(name, ".zip") && !parents[strings.TrimSuffix(BaseName(name), ".zip")]
			})
		}
	}
	cue := false
	if extensions["cue"] {
		for _, file := range request.Files {
			cue = cue || HasSuffixFold(file.Name, ".cue")
		}
	}
	return chooseFile(request, request.Files, func(name string) bool {
		if cue {
			return strings.HasSuffix(name, ".cue")
		}
		return extensions[name[strings.LastIndex(name, ".")+1:]]
	})
}

func flycastParentNames(request *ConfigureRequest) map[string]bool {
	parents := map[string]bool{}
	for _, file := range request.Files {
		for _, catalog := range request.FlycastTables {
			for _, machine := range catalog {
				if machine.Name == ArchiveID(file.Name) && machine.Parent != nil && *machine.Parent != "" {
					parents[*machine.Parent] = true
				}
			}
		}
	}
	return parents
}

func flycastConfigureParents(request *ConfigureRequest, entryFile string) map[string]any {
	entry := FindFile(request.Files, entryFile)
	cores := map[string]any{}
	for _, coreID := range request.CoreIDs {
		catalog, exists := request.FlycastTables[coreID]
		if !exists {
			continue
		}
		parent := ""
		for _, machine := range catalog {
			if machine.Name == ArchiveID(entry.Name) {
				parent = optionalString(machine.Parent)
				break
			}
		}
		files := []any{}
		for _, file := range request.Files {
			if parent != "" && ArchiveID(file.Name) == parent && HasSuffixFold(file.Name, ".zip") {
				files = append(files, file.LogicalKey)
			}
		}
		if len(files) > 0 {
			cores[coreID] = map[string]any{"parentFiles": files}
		}
	}
	return cores
}

func arcadeAncestors(catalog *ArcadeCatalog, id string) ([]string, error) {
	parents, seen := []string{}, map[string]bool{id: true}
	for machine := catalog.Machine(id); machine.ParentID() != ""; {
		parent := machine.ParentID()
		if seen[parent] || len(seen) > 32 {
			return nil, Fail("RUNTIME_ARCADE_CATALOG_INVALID")
		}
		seen[parent] = true
		parents = append(parents, parent)
		machine = catalog.Machine(parent)
	}
	return parents, nil
}

func arcadeEntry(request *ConfigureRequest) (*File, error) {
	var candidates []File
	for _, file := range request.Files {
		if !HasSuffixFold(file.Name, ".zip") {
			continue
		}
		excluded := false
		for _, core := range request.CoreIDs {
			if machine := request.ArcadeCatalogs[core].Machine(ArchiveID(file.Name)); machine != nil && !Playable(machine) {
				excluded = true
			}
		}
		if !excluded {
			candidates = append(candidates, file)
		}
	}
	if request.selectedEntry() != "" {
		return chooseFile(request, candidates, func(name string) bool { return strings.HasSuffix(name, ".zip") })
	}
	parents := map[string]bool{}
	for _, core := range request.CoreIDs {
		for _, file := range candidates {
			ancestors, err := arcadeAncestors(request.ArcadeCatalogs[core], ArchiveID(file.Name))
			if err != nil {
				return nil, err
			}
			for _, parent := range ancestors {
				parents[parent] = true
			}
		}
	}
	var leaves []*File
	for index := range candidates {
		if !parents[ArchiveID(candidates[index].Name)] {
			leaves = append(leaves, &candidates[index])
		}
	}
	if len(leaves) != 1 {
		return nil, Fail("RUNTIME_ENTRY_REQUIRED")
	}
	return leaves[0], nil
}

// parentArchives selects the unique uploaded archive of each non-BIOS ancestor.
func parentArchives(files []File, catalog *ArcadeCatalog, ancestors []string) ([]any, error) {
	parentFiles := []any{}
	for _, parent := range ancestors {
		if machine := catalog.Machine(parent); machine != nil && machine.BIOS {
			continue
		}
		var matches []string
		for _, item := range files {
			if HasSuffixFold(item.Name, ".zip") && ArchiveID(item.Name) == parent {
				matches = append(matches, item.LogicalKey)
			}
		}
		if len(matches) > 1 {
			return nil, Fail("RUNTIME_ENTRY_REQUIRED")
		}
		if len(matches) == 1 {
			parentFiles = append(parentFiles, matches[0])
		}
	}
	return parentFiles, nil
}

func arcadeConfigureParents(request *ConfigureRequest, entry string) (map[string]any, error) {
	file := FindFile(request.Files, entry)
	cores := map[string]any{}
	for _, core := range request.CoreIDs {
		catalog := request.ArcadeCatalogs[core]
		ancestors, err := arcadeAncestors(catalog, ArchiveID(file.Name))
		if err != nil {
			return nil, err
		}
		parentFiles, err := parentArchives(request.Files, catalog, ancestors)
		if err != nil {
			return nil, err
		}
		if len(parentFiles) > 0 {
			cores[core] = map[string]any{"parentFiles": parentFiles}
		}
	}
	return cores, nil
}

func chooseFile(request *ConfigureRequest, files []File, test func(string) bool) (*File, error) {
	var candidates []*File
	for index := range files {
		if test(Lower(files[index].Name)) {
			candidates = append(candidates, &files[index])
		}
	}
	if selected := request.selectedEntry(); selected != "" {
		for _, candidate := range candidates {
			if candidate.LogicalKey == selected {
				return candidate, nil
			}
		}
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	if len(candidates) != 1 {
		return nil, Fail("RUNTIME_ENTRY_REQUIRED")
	}
	return candidates[0], nil
}

func choosePreferred(request *ConfigureRequest, patterns []*regexp.Regexp) (*File, error) {
	if request.selectedEntry() != "" {
		return chooseFile(request, request.Files, fileEntryAny)
	}
	for _, pattern := range patterns {
		var matching []*File
		for index := range request.Files {
			if pattern.MatchString(Lower(request.Files[index].Name)) {
				matching = append(matching, &request.Files[index])
			}
		}
		if len(matching) == 1 {
			return matching[0], nil
		}
		if len(matching) > 1 {
			return nil, Fail("RUNTIME_ENTRY_REQUIRED")
		}
	}
	return nil, Fail("RUNTIME_ENTRY_MISSING")
}

type rpgProject struct {
	entry  string
	engine string
	rtp    string
}

// rpgProjects lists each engine marker's sibling index.html with its engine and declared RTP.
func rpgProjects(request *ConfigureRequest) ([]rpgProject, error) {
	var projects []rpgProject
	for _, file := range request.Files {
		engine, err := rpgEngine(request, &file)
		if err != nil {
			return nil, err
		}
		if engine == "" {
			continue
		}
		path := Lower(coreScript.ReplaceAllString(file.LogicalKey, "index.html"))
		rtp := declaredRTP(engine, evidenceText(request, file.LogicalKey))
		for _, entry := range request.Files {
			if Lower(entry.LogicalKey) == path {
				projects = append(projects, rpgProject{entry.LogicalKey, engine, rtp})
			}
		}
	}
	return projects, nil
}

func selectedRPG(projects []rpgProject, selected string) (*Content, error) {
	var matches []rpgProject
	for _, project := range projects {
		if project.entry == selected {
			matches = append(matches, project)
		}
	}
	if len(matches) == 0 {
		return nil, Fail("RUNTIME_RPG_ENTRY_INVALID")
	}
	if len(matches) != 1 {
		return nil, Fail("RUNTIME_RPG_ENGINE_AMBIGUOUS")
	}
	return matches[0].content(), nil
}

func rpgContent(request *ConfigureRequest) (*Content, error) {
	projects, err := rpgProjects(request)
	if err != nil {
		return nil, err
	}
	if selected := request.selectedEntry(); selected != "" {
		return selectedRPG(projects, selected)
	}
	if len(projects) == 0 {
		return nil, Fail("RUNTIME_RPG_ENGINE_AMBIGUOUS")
	}
	var defaults []rpgProject
	for _, project := range projects {
		if len(projects) == 1 || Lower(project.entry) == "index.html" && sameEngine(projects, project.engine) {
			defaults = append(defaults, project)
		}
	}
	if len(defaults) != 1 {
		return nil, Fail("RUNTIME_ENTRY_REQUIRED")
	}
	return defaults[0].content(), nil
}

func (p rpgProject) content() *Content {
	entry, engine := p.entry, p.engine
	content := &Content{Kind: "RPG_MAKER_PROJECT", EntryFile: &entry, Engine: &engine}
	if p.rtp != "" {
		rtp := p.rtp
		content.RTP = &rtp
	}
	return content
}

func sameEngine(projects []rpgProject, engine string) bool {
	for _, project := range projects {
		if project.engine != engine {
			return false
		}
	}
	return true
}

func evidenceText(request *ConfigureRequest, key string) string {
	if record, exists := request.Evidence[key]; exists && record.Text != nil {
		return *record.Text
	}
	return ""
}

// rpgEngine reproduces the sequential Map.set of the source: a later rule for the same file replaces its engine.
func rpgEngine(request *ConfigureRequest, file *File) (string, error) {
	name, engine := Lower(file.LogicalKey), ""
	if mzScript.MatchString(name) {
		engine = "RPGMZ"
	}
	if mvScript.MatchString(name) {
		engine = "RPGMV"
	}
	if gameINI.MatchString(name) {
		match := rgssScripts.FindStringSubmatch(evidenceText(request, file.LogicalKey))
		switch {
		case match == nil:
			return "", Fail("RUNTIME_RPG_EVIDENCE_REQUIRED")
		case Lower(match[1]) == "rxdata":
			engine = "RPGXP"
		case Lower(match[1]) == "rvdata":
			engine = "RPGVX"
		default:
			engine = "RPGVXACE"
		}
	}
	if lcfDatabase.MatchString(name) {
		record := request.Evidence[file.LogicalKey]
		if record.BytesBase64 == nil || *record.BytesBase64 == "" {
			return "", Fail("RUNTIME_RPG_EVIDENCE_REQUIRED")
		}
		data, err := base64.StdEncoding.DecodeString(*record.BytesBase64)
		if err != nil {
			return "", Fail("RUNTIME_RPG_EVIDENCE_INVALID")
		}
		if engine, err = detectLCFEngine(data); err != nil {
			return "", err
		}
	}
	return engine, nil
}

// declaredRTP is the engine's official RTP when the [Game] section declares it in RTP or RTP1-RTP3.
func declaredRTP(engine, ini string) string {
	official, rgss := OfficialRTP[engine]
	if !rgss {
		return ""
	}
	section := ""
	for _, line := range lineBreak.Split(ini, -1) {
		if header := rtpHeader.FindStringSubmatch(line); header != nil {
			section = Lower(strings.TrimSpace(header[1]))
			continue
		}
		if entry := rtpEntry.FindStringSubmatch(line); section == "game" && entry != nil &&
			Lower(entry[2]) == Lower(official) {
			return official
		}
	}
	return ""
}

// lcfDatabaseID reads the single System chunk's database ID from the top-level chunk list, or -1 without one.
func lcfDatabaseID(reader *lcfReader) (int, error) {
	invalid := Fail("RUNTIME_RPG_EVIDENCE_INVALID")
	databaseID := -1
	for !reader.done() {
		id, ok := reader.integer()
		if !ok {
			return 0, invalid
		}
		if id == 0 {
			if !reader.done() {
				return 0, invalid
			}
			break
		}
		size, ok := reader.integer()
		chunk, taken := reader.take(size)
		if !ok || !taken {
			return 0, invalid
		}
		if id != 0x16 {
			continue
		}
		if databaseID != -1 {
			return 0, invalid
		}
		value, err := lcfSystemID(chunk)
		if err != nil {
			return 0, err
		}
		databaseID = value
	}
	return databaseID, nil
}

// detectLCFEngine reads the LCF System chunk database ID that distinguishes 2000 and 2003.
func detectLCFEngine(data []byte) (string, error) {
	invalid := Fail("RUNTIME_RPG_EVIDENCE_INVALID")
	if len(data) > 24*1024*1024 {
		return "", invalid
	}
	reader := &lcfReader{data: data}
	length, ok := reader.integer()
	header, taken := reader.take(length)
	if !ok || !taken || string(header) != "LcfDataBase" {
		return "", invalid
	}
	databaseID, err := lcfDatabaseID(reader)
	if err != nil {
		return "", err
	}
	switch databaseID {
	case 0:
		return "RPG2000", nil
	case 2003:
		return "RPG2003", nil
	}
	return "", invalid
}

func lcfSystemID(data []byte) (int, error) {
	invalid := Fail("RUNTIME_RPG_EVIDENCE_INVALID")
	reader := &lcfReader{data: data}
	databaseID, found := 0, false
	for !reader.done() {
		id, ok := reader.integer()
		if !ok {
			return 0, invalid
		}
		if id == 0 && reader.done() {
			return databaseID, nil
		}
		if id == 0 {
			return 0, invalid
		}
		size, ok := reader.integer()
		chunk, taken := reader.take(size)
		if !ok || !taken {
			return 0, invalid
		}
		if id != 0x0a {
			continue
		}
		if found {
			return 0, invalid
		}
		found = true
		value := &lcfReader{data: chunk}
		parsed, ok := value.integer()
		if !ok || !value.done() {
			return 0, invalid
		}
		databaseID = parsed
	}
	return 0, invalid
}

type lcfReader struct {
	data   []byte
	offset int
}

func (r *lcfReader) done() bool { return r.offset == len(r.data) }

func (r *lcfReader) integer() (int, bool) {
	value := 0
	for range 5 {
		next, ok := r.take(1)
		if !ok {
			return 0, false
		}
		value = value*128 + int(next[0]&127)
		if value > 0xffffffff {
			return 0, false
		}
		if next[0] < 128 {
			return value, true
		}
	}
	return 0, false
}

func (r *lcfReader) take(length int) ([]byte, bool) {
	if length < 0 || length > len(r.data)-r.offset {
		return nil, false
	}
	result := r.data[r.offset : r.offset+length]
	r.offset += length
	return result, true
}

var (
	onsModes = map[string]int{"0.txt": 0, "00.txt": 0, "nscr_sec.dat": 2, "nscript.dat": 1}
	onsMagic = []byte{0x79, 0x57, 0x0d, 0x80, 0x04}
)

// onsScriptEncoding detects the --enc value from the script the engine will actually read.
func onsScriptEncoding(files []File, entry string, evidence map[string]ConfigureEvidence) (string, error) {
	root := Root(entry)
	for _, name := range ONSScriptNames {
		key := root + name
		file := FindFile(files, key)
		if file == nil {
			continue
		}
		record := evidence[key]
		if record.PrefixBase64 == nil {
			return "", Fail("RUNTIME_EVIDENCE_REQUIRED")
		}
		data, err := base64.StdEncoding.DecodeString(*record.PrefixBase64)
		if err != nil || float64(len(data)) != min(file.SizeBytes, ONSSampleBytes) {
			return "", Fail("RUNTIME_EVIDENCE_INVALID")
		}
		decoded := decodeONSScript(data, onsModes[name])
		if float64(len(data)) < file.SizeBytes {
			if end := lastNewline(decoded); end >= 0 {
				decoded = decoded[:end+1]
			}
		}
		return detectONSEncoding(decoded), nil
	}
	return "", Fail("RUNTIME_ENTRY_MISSING")
}

func lastNewline(data []byte) int {
	for index := len(data) - 1; index >= 0; index-- {
		if data[index] == 0x0a {
			return index
		}
	}
	return -1
}

func decodeONSScript(data []byte, mode int) []byte {
	if mode == 0 {
		return data
	}
	result := make([]byte, len(data))
	for index, value := range data {
		if mode == 1 {
			result[index] = value ^ 0x84
		} else {
			result[index] = value ^ onsMagic[index%len(onsMagic)]
		}
	}
	return result
}

func detectONSEncoding(data []byte) string {
	ascii := true
	for _, value := range data {
		ascii = ascii && value < 0x80
	}
	if ascii || decodedStats("utf-8", data).errors == 0 {
		return "utf8"
	}
	gbk, sjis := decodedStats("gbk", data), decodedStats("shift_jis", data)
	// Most Shift_JIS byte pairs are also valid GBK, so Japanese text is recognized by its kana.
	if sjis.errors <= gbk.errors && sjis.kana*20 >= sjis.wide {
		return "sjis"
	}
	if gbk.errors <= sjis.errors {
		return "gbk"
	}
	return "sjis"
}

type textStats struct{ errors, kana, wide int }

func decodedStats(encoding string, data []byte) textStats {
	var stats textStats
	for _, character := range textcodec.DecodeLossy(data, encoding) {
		switch {
		case character == 0xfffd:
			stats.errors++
		case character >= 0x80:
			stats.wide++
			if character >= 0x3040 && character <= 0x30ff {
				stats.kana++
			}
		}
	}
	return stats
}

// kirikiriProject keeps the candidates of the shallowest directory, which must contain every candidate.
func kirikiriProject(candidates []string) ([]string, error) {
	root := Root(candidates[0])
	for _, candidate := range candidates[1:] {
		if directory := Root(candidate); UTF16Length(directory) < UTF16Length(root) {
			root = directory
		}
	}
	for _, path := range candidates {
		if !strings.HasPrefix(path, root) {
			return nil, Fail("RUNTIME_ENTRY_REQUIRED", "candidates", jsonList(candidates))
		}
	}
	var project []string
	for _, path := range candidates {
		if Root(path) == root {
			project = append(project, path)
		}
	}
	return project, nil
}

// kirikiriDataArchives are data-named project candidates proven to be XP3 archives.
func kirikiriDataArchives(files []File, evidence map[string]Evidence, project []string) ([]string, error) {
	var dataArchives []string
	for _, path := range project {
		if !dataAny.MatchString(path) {
			continue
		}
		xp3, err := isXP3(FindFile(files, path), evidence)
		if err != nil {
			return nil, err
		}
		if xp3 {
			dataArchives = append(dataArchives, path)
		}
	}
	return dataArchives, nil
}

// KirikiriEntry selects the project entry by root depth, then engine conventions.
func KirikiriEntry(files []File, evidence map[string]Evidence, selected string) (string, error) {
	candidates, err := KirikiriEntryCandidates(files, evidence)
	if err != nil {
		return "", err
	}
	if selected != "" {
		if !contains(candidates, selected) {
			return "", Fail("RUNTIME_ENTRY_MISSING")
		}
		return selected, nil
	}
	if len(candidates) == 0 {
		return "", Fail("RUNTIME_ENTRY_MISSING")
	}
	project, err := kirikiriProject(candidates)
	if err != nil {
		return "", err
	}
	dataArchives, err := kirikiriDataArchives(files, evidence, project)
	if err != nil {
		return "", err
	}
	tiers := [][]string{
		filterPaths(project, startupScript.MatchString), filterPaths(project, dataXP3.MatchString), dataArchives, project,
	}
	for _, tier := range tiers {
		switch len(tier) {
		case 0:
			continue
		case 1:
			return tier[0], nil
		default:
			return "", Fail("RUNTIME_ENTRY_REQUIRED", "candidates", jsonList(tier))
		}
	}
	return "", Fail("RUNTIME_ENTRY_MISSING")
}

var (
	startupScript = regexp.MustCompile(`(?i)(?:^|/)startup\.tjs$`)
	dataXP3       = regexp.MustCompile(`(?i)(?:^|/)data\.xp3$`)
	dataAny       = regexp.MustCompile(`(?i)(?:^|/)data\.[^/]+$`)
)

func filterPaths(paths []string, test func(string) bool) []string {
	var result []string
	for _, path := range paths {
		if test(path) {
			result = append(result, path)
		}
	}
	return result
}

func jsonList(values []string) string {
	items := make([]string, len(values))
	for index, value := range values {
		items[index] = JSONString(value)
	}
	return "[" + strings.Join(items, ",") + "]"
}
