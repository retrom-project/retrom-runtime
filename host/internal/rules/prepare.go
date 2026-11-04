package rules

import (
	"encoding/json"
	"strings"
)

// Directory is a Game directory's platform and allowed cores.
type Directory struct {
	PlatformID     string   `json:"platformId"`
	DefaultCoreID  string   `json:"defaultCoreId"`
	AllowedCoreIDs []string `json:"allowedCoreIds"`
}

// PrepareRequest is the launch-preparation input, including host-read evidence.
type PrepareRequest struct {
	Directory      Directory                  `json:"directory"`
	Config         any                        `json:"config"`
	Files          []File                     `json:"files"`
	CoreID         *string                    `json:"coreId,omitempty"`
	SavedContext   any                        `json:"savedContext,omitempty"`
	Fingerprints   map[string]string          `json:"fingerprints"`
	Archives       map[string][]ArchiveMember `json:"-"`
	ArcadeCatalog  *ArcadeCatalog             `json:"-"`
	CHDHeaders     map[string]CHDHeader       `json:"-"`
	FlycastCatalog []FlycastMachine           `json:"-"`
	FlycastLoaded  bool                       `json:"-"`
	CueFiles       []string                   `json:"-"`
	CueKnown       bool                       `json:"-"`
	DOSEntries     []string                   `json:"-"`
	Evidence       *FirmwareEvidence          `json:"-"`
}

// SelectedCore validates the directory and returns the requested or default core.
func SelectedCore(directory *Directory, coreID *string) (string, error) {
	selected := directory.DefaultCoreID
	if coreID != nil {
		selected = *coreID
	}
	unique := map[string]bool{}
	valid := Identifier(directory.PlatformID) && Identifier(directory.DefaultCoreID) && Identifier(selected) &&
		directory.AllowedCoreIDs != nil
	for _, id := range directory.AllowedCoreIDs {
		valid = valid && Identifier(id) && !unique[id]
		unique[id] = true
	}
	if !valid || !unique[directory.DefaultCoreID] || !unique[selected] {
		return "", Fail("RUNTIME_CORE_UNAVAILABLE", "coreId", selected)
	}
	return selected, nil
}

func identityMode(kind string, files []File) string {
	if kind != "SINGLE_FILE" && kind != "DOS_BUNDLE" && kind != "ARCADE" || len(files) != 1 {
		return "TREE"
	}
	return "FILE"
}

func isProject(kind string) bool {
	return kind != "SINGLE_FILE" && kind != "DOS_BUNDLE" && kind != "ARCADE"
}

var savedKeys = []string{
	"coreId", "providerId", "targetId", "coreFingerprint", "romHash", "checkpointFormat", "content", "runtimeOptions",
}

func parseSavedContext(value any) (*SaveContext, error) {
	saved, ok := Object(value)
	invalid := Fail("RUNTIME_SAVED_CONTEXT_INVALID")
	if !ok || !Exact(saved, savedKeys, "romSet") || !Identifier(saved["coreId"]) || !Identifier(saved["providerId"]) ||
		!Identifier(saved["targetId"]) || !Digest(saved["coreFingerprint"]) || !Digest(saved["romHash"]) {
		return nil, invalid
	}
	format, isText := saved["checkpointFormat"].(string)
	options, isObject := Object(saved["runtimeOptions"])
	if !isText || !isObject {
		return nil, invalid
	}
	// The identity fields were validated as identifiers and digests above.
	coreID, _ := saved["coreId"].(string)
	providerID, _ := saved["providerId"].(string)
	targetID, _ := saved["targetId"].(string)
	fingerprint, _ := saved["coreFingerprint"].(string)
	romHash, _ := saved["romHash"].(string)
	context := &SaveContext{
		Identity: Identity{
			CoreID: coreID, ProviderID: providerID, TargetID: targetID, CoreFingerprint: fingerprint, ROMHash: romHash,
		},
		CheckpointFormat: format, RuntimeOptions: options, Content: saved["content"],
	}
	if romSet, exists := saved["romSet"]; exists {
		text, isText := romSet.(string)
		if !isText || !romSetPattern.MatchString(text) {
			return nil, invalid
		}
		context.ROMSet = &text
	}
	return context, nil
}

// savedCore parses the saved context, whose core must be the requested one and available on the platform.
func savedCore(request *PrepareRequest) (*SaveContext, error) {
	saved, err := parseSavedContext(request.SavedContext)
	if err != nil {
		return nil, err
	}
	if request.CoreID != nil && *request.CoreID != saved.CoreID {
		return nil, Fail("CORE_UNAVAILABLE")
	}
	if _, err := SelectedCore(&request.Directory, &saved.CoreID); err != nil {
		return nil, Fail("CORE_UNAVAILABLE")
	}
	return saved, nil
}

// savedRestorable applies the restore decision to the current content and Target identity.
func savedRestorable(request *PrepareRequest, saved *SaveContext, resolved *Resolved, kind string) error {
	romHash, err := ContentHash(request.Files, identityMode(kind, request.Files))
	if err != nil {
		return err
	}
	restore := &RestoreInput{
		GameAvailable: true, SaveAvailable: true, ReadFormats: readFormats(resolved.Target),
		Current: &Identity{
			CoreID: saved.CoreID, ProviderID: resolved.Provider.ID, TargetID: resolved.Target.ID,
			CoreFingerprint: request.Fingerprints[resolved.Provider.ID+"/"+resolved.Target.ID], ROMHash: romHash,
		},
	}
	restore.Context.Identity, restore.Context.CheckpointFormat = saved.Identity, saved.CheckpointFormat
	if decision := Restore(restore); !decision.Restorable {
		return Fail(*decision.Reason)
	}
	return nil
}

// savedConfiguration freezes the saved core options and ROM set while keeping the current parent files.
func savedConfiguration(current *Configuration, saved *SaveContext, content Content, options map[string]any,
) *Configuration {
	core := &CoreConfiguration{Options: &options, ROMSet: saved.ROMSet}
	if existing := current.Core(saved.CoreID); existing != nil {
		core.ParentFiles = existing.ParentFiles
	}
	return &Configuration{Content: content, Cores: &map[string]*CoreConfiguration{saved.CoreID: core}}
}

// ResolveSaved resolves frozen Save facts before content-specific host reads or resource assembly.
func (f *Facts) ResolveSaved(request *PrepareRequest) (*PrepareRequest, error) {
	if request.SavedContext == nil {
		return request, nil
	}
	saved, err := savedCore(request)
	if err != nil {
		return nil, err
	}
	current, err := ParseConfiguration(request.Config)
	if err != nil {
		return nil, err
	}
	frozen, err := ParseConfiguration(map[string]any{"content": saved.Content})
	if err != nil {
		return nil, Fail("RUNTIME_SAVED_CONTEXT_INVALID")
	}
	content := frozen.Content
	resolved, err := f.ResolveTarget(request.Directory.PlatformID, saved.CoreID, &content)
	if err != nil {
		return nil, err
	}
	if err := savedRestorable(request, saved, resolved, content.Kind); err != nil {
		return nil, err
	}
	options, err := ValidateTargetOptions(saved.RuntimeOptions, resolved.Target.OptionsSchema)
	if err != nil {
		return nil, Fail("RUNTIME_SAVED_CONTEXT_INVALID")
	}
	// A raw single-file identity permits a rename; a tree identity remains path-sensitive.
	if !isProject(content.Kind) && len(request.Files) == 1 && content.EntryFile != nil {
		key := request.Files[0].LogicalKey
		content.EntryFile = &key
	}
	config := savedConfiguration(current, saved, content, options)
	actual, err := f.prepareTargetOptions(config, resolved.Target, saved.CoreID, request.Files)
	if err != nil {
		return nil, err
	}
	if equal, err := CanonicalEqual(actual, options); err != nil || !equal {
		return nil, Fail("RUNTIME_SAVED_CONTEXT_INVALID")
	}
	normalized := *request
	normalized.Config, normalized.CoreID, normalized.SavedContext = configValue(config), &saved.CoreID, nil
	return &normalized, nil
}

// configValue converts a validated configuration back to its JSON value.
func configValue(config *Configuration) any {
	encoded, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	var value any
	if err := json.Unmarshal(encoded, &value); err != nil {
		panic(err)
	}
	return value
}

// configObject converts a validated configuration to its JSON object and content object.
func configObject(config *Configuration) (map[string]any, map[string]any, error) {
	object, isObject := configValue(config).(map[string]any)
	content, hasContent := object["content"].(map[string]any)
	if !isObject || !hasContent {
		return nil, nil, Invalid()
	}
	return object, content, nil
}

func readFormats(target *Target) []string {
	if target.Checkpoint == nil {
		return []string{}
	}
	return target.Checkpoint.ReadFormats
}

type preparedIdentity struct {
	config       *Configuration
	selectedCore string
	resolved     *Resolved
	options      map[string]any
	identity     Identity
}

func (f *Facts) prepareIdentity(request *PrepareRequest) (*preparedIdentity, error) {
	request, err := f.ResolveSaved(request)
	if err != nil {
		return nil, err
	}
	config, err := ParseConfiguration(request.Config)
	if err != nil {
		return nil, err
	}
	selected, err := SelectedCore(&request.Directory, request.CoreID)
	if err != nil {
		return nil, err
	}
	if err := ValidateConfigurationFiles(config, request.Files); err != nil {
		return nil, err
	}
	if err := f.ValidateConfiguredOptions(request.Directory.PlatformID, config, request.Files); err != nil {
		return nil, err
	}
	resolved, err := f.ResolveTarget(request.Directory.PlatformID, selected, &config.Content)
	if err != nil {
		return nil, err
	}
	fingerprint := request.Fingerprints[resolved.Provider.ID+"/"+resolved.Target.ID]
	if !Digest(fingerprint) {
		return nil, Fail("RUNTIME_IMPLEMENTATION_UNAVAILABLE")
	}
	options, err := f.prepareTargetOptions(config, resolved.Target, selected, request.Files)
	if err != nil {
		return nil, err
	}
	romHash, err := ContentHash(request.Files, identityMode(config.Content.Kind, request.Files))
	if err != nil {
		return nil, err
	}
	return &preparedIdentity{
		config: config, selectedCore: selected, resolved: resolved, options: options,
		identity: Identity{
			CoreID: resolved.Binding.CoreID, ProviderID: resolved.Binding.ProviderID,
			TargetID: resolved.Binding.TargetID, CoreFingerprint: fingerprint, ROMHash: romHash,
		},
	}, nil
}

// IdentityResult is a list identity without reading archives or preparing resources.
type IdentityResult struct {
	Identity
	ReadFormats []string `json:"readFormats"`
}

// InspectIdentity uses the same identity rules as a launch.
func (f *Facts) InspectIdentity(request *PrepareRequest) (*IdentityResult, error) {
	prepared, err := f.prepareIdentity(request)
	if err != nil {
		return nil, err
	}
	return &IdentityResult{Identity: prepared.identity, ReadFormats: readFormats(prepared.resolved.Target)}, nil
}

// ValidateConfiguredOptions prepares options for every configured core.
func (f *Facts) ValidateConfiguredOptions(platformID string, config *Configuration, files []File) error {
	for _, coreID := range config.CoreIDs() {
		resolved, err := f.ResolveTarget(platformID, coreID, &config.Content)
		if err != nil {
			return err
		}
		if _, err := f.prepareTargetOptions(config, resolved.Target, coreID, files); err != nil {
			return err
		}
	}
	return nil
}

// entryPathOptions derives the PSP project entry and the DOS entry path options.
func entryPathOptions(config *Configuration, target *Target, options map[string]any, files []File) error {
	if target.ID == "ppsspp" {
		options["projectEntryPath"] = nil
		if path, ok := pspProjectEntry(config, files); ok {
			options["projectEntryPath"] = path
		}
	}
	switch {
	case target.ID == "dosbox-pure":
		if config.Content.Kind != "DOS_BUNDLE" {
			return Invalid()
		}
		options["dosEntryPath"] = nil
		if config.Content.EntryPath != nil {
			options["dosEntryPath"] = *config.Content.EntryPath
		}
	case strings.HasPrefix(target.AdapterID, "emulatorjs"):
		options["dosEntryPath"] = nil
	}
	return nil
}

func (f *Facts) prepareTargetOptions(config *Configuration, target *Target, coreID string, files []File,
) (map[string]any, error) {
	options := map[string]any{}
	if core := config.Core(coreID); core != nil && core.Options != nil {
		options = cloneObject(*core.Options)
	}
	entry, hasEntry := config.Content.Entry()
	if target.ID == "theodore" && hasEntry {
		options = thomsonModelOptions(options, entry, files)
	}
	if err := entryPathOptions(config, target, options, files); err != nil {
		return nil, err
	}
	if target.ID == "kirikiri2-kag" {
		prepared, err := prepareKirikiriOptions(config, options, files)
		if err != nil {
			return nil, err
		}
		options = prepared
	}
	if err := validateSiglusOptions(config, target, options, files); err != nil {
		return nil, err
	}
	if target.ROMSetSelection != nil && target.ROMSetSelection.Driver == "MACHINE_OPTION" {
		file := FindFile(files, entry)
		if file == nil || file.Name == "" {
			return nil, Fail("RUNTIME_ENTRY_MISSING")
		}
		options["machine"] = ConfiguredMachine(coreID, config, file.Name)
	}
	validated, err := ValidateTargetOptions(options, target.OptionsSchema)
	if err != nil {
		return nil, Fail("RUNTIME_OPTIONS_INVALID", "coreId", coreID)
	}
	return validated, nil
}

// Prepared is the launch plan returned to the Host.
type Prepared struct {
	Identity
	Config           *Configuration      `json:"config"`
	TargetOptions    map[string]any      `json:"targetOptions"`
	Dependencies     *ArcadeDependencies `json:"dependencies"`
	ROMSet           *string             `json:"romSet,omitempty"`
	CRCWarnings      []CRCWarning        `json:"crcWarnings"`
	BIOSRequirements []BIOSRequirement   `json:"biosRequirements"`
	Checkpoint       *Checkpoint         `json:"checkpoint"`
	Capabilities     json.RawMessage     `json:"capabilities"`
	Resources        []ResourcePlan      `json:"resources"`
}

// ResourcePlan is a generic host assembly plan; core selection and layout remain runtime decisions.
type ResourcePlan struct {
	Role            string            `json:"role"`
	Kind            string            `json:"kind"`
	Ordinal         int               `json:"ordinal"`
	Files           []string          `json:"files"`
	EntryFile       *string           `json:"entryFile,omitempty"`
	BridgeAssetPath *string           `json:"bridgeAssetPath,omitempty"`
	Encoding        *string           `json:"encoding,omitempty"`
	Paths           map[string]string `json:"paths,omitempty"`
}

// Prepare produces the launch identity, options, requirements and resource plan.
func (f *Facts) Prepare(request *PrepareRequest) (*Prepared, error) {
	request, err := f.ResolveSaved(request)
	if err != nil {
		return nil, err
	}
	prepared, err := f.prepareIdentity(request)
	if err != nil {
		return nil, err
	}
	config, target := prepared.config, prepared.resolved.Target
	content, err := f.prepareContent(request, config, prepared.selectedCore, target)
	if err != nil {
		return nil, err
	}
	result := &Prepared{
		Identity: prepared.identity, Config: config, TargetOptions: prepared.options,
		Dependencies: content.dependencies, CRCWarnings: content.crcWarnings, Checkpoint: target.Checkpoint,
		Capabilities: target.Capabilities,
	}
	entryKey, _ := config.Content.Entry()
	if entry := FindFile(request.Files, entryKey); target.ROMSetSelection != nil && entry != nil {
		machine := ConfiguredMachine(prepared.selectedCore, config, entry.Name)
		result.ROMSet = &machine
	}
	requirements, err := f.ResolveBIOSRequirements(&BIOSRequest{
		ProviderID: prepared.resolved.Binding.ProviderID,
		TargetID:   prepared.resolved.Binding.TargetID, Config: config, Files: request.Files, Evidence: request.Evidence,
	})
	if err != nil {
		return nil, err
	}
	if request.ArcadeCatalog != nil {
		requirements = append(requirements, f.ArcadeBIOSRequirements(prepared.selectedCore, request.ArcadeCatalog,
			content.dependencies.BIOSSets, true)...)
	}
	result.BIOSRequirements = requirements
	resources, err := contentResources(config, target, prepared.selectedCore, request, content.flycast)
	if err != nil {
		return nil, err
	}
	if content.media != nil && len(content.media.MediaFiles) > 0 {
		resources = append(resources, ResourcePlan{
			Role: "media", Kind: "EXTERNAL_FILE_SET",
			Files: content.media.MediaFiles, Paths: content.media.MediaPaths,
		})
	}
	result.Resources = resources
	return result, nil
}

type preparedContent struct {
	crcWarnings  []CRCWarning
	flycast      *FlycastResult
	dependencies *ArcadeDependencies
	media        *Media
}

func (f *Facts) prepareContent(request *PrepareRequest, config *Configuration, coreID string, target *Target,
) (*preparedContent, error) {
	result := &preparedContent{
		crcWarnings:  []CRCWarning{},
		dependencies: &ArcadeDependencies{ParentFiles: []string{}, MissingParents: []string{}, BIOSSets: []string{}},
	}
	if requirements := target.ContentRequirements; requirements != nil && requirements.Kind == "FLYCAST_CARTRIDGE" {
		flycast, err := FlycastDependencies(requirements.Platform, coreID, config, request.Files, request.FlycastCatalog,
			request.FlycastLoaded, request.Archives)
		if err != nil {
			return nil, err
		}
		if err := RequireFlycast(flycast); err != nil {
			return nil, err
		}
		result.flycast, result.crcWarnings = flycast, flycast.CRCWarnings
	}
	if config.Content.Kind == "DOS_BUNDLE" && config.Content.EntryPath != nil &&
		!contains(request.DOSEntries, *config.Content.EntryPath) {
		return nil, Fail("RUNTIME_DOS_ENTRY_INVALID")
	}
	if config.Content.Kind == "ARCADE" {
		if err := f.prepareArcade(request, config, coreID, result); err != nil {
			return nil, err
		}
	}
	if result.flycast != nil {
		result.dependencies = &ArcadeDependencies{
			ParentFiles:    result.flycast.ParentFiles,
			MissingParents: result.flycast.MissingParents, BIOSSets: []string{},
		}
	}
	return result, nil
}

func (f *Facts) prepareArcade(request *PrepareRequest, config *Configuration, coreID string,
	result *preparedContent,
) error {
	if request.ArcadeCatalog == nil || request.Archives == nil {
		return Fail("RUNTIME_ARCADE_CATALOG_UNAVAILABLE")
	}
	dependencies, err := Dependencies(coreID, config, request.Files, request.Archives, request.ArcadeCatalog,
		f.Provenance)
	if err != nil {
		return err
	}
	media, err := ArcadeMedia(coreID, config, request.Files, request.ArcadeCatalog, request.CHDHeaders)
	if err != nil {
		return err
	}
	if err := RequireArcadeMedia(media); err != nil {
		return err
	}
	warnings, err := ArcadeCRCWarnings(coreID, config, request.Files, request.Archives, request.ArcadeCatalog)
	if err != nil {
		return err
	}
	if len(dependencies.MissingParents) > 0 {
		return Fail("RUNTIME_PARENT_MISSING", "parents", strings.Join(dependencies.MissingParents, ","))
	}
	result.dependencies, result.media, result.crcWarnings = dependencies, media, warnings
	return nil
}

func contentResources(config *Configuration, target *Target, coreID string, request *PrepareRequest,
	flycast *FlycastResult,
) ([]ResourcePlan, error) {
	game := targetInput(target, "game")
	if game == nil {
		return nil, Fail("RUNTIME_DECLARATION_INVALID")
	}
	_, pspProject := pspProjectEntry(config, request.Files)
	pspProject = pspProject && target.ID == "ppsspp"
	resource, err := gameResource(game.Kind, config, request.Files, pspProject)
	if err != nil {
		return nil, err
	}
	if err := arcadeResourcePath(resource, config, target, coreID, request.Files); err != nil {
		return nil, err
	}
	if game.Kind == "NATIVE_WEB" || game.Kind == "ISOLATED_WEB" {
		var bridges []string
		for _, path := range target.AssetPaths {
			if strings.HasSuffix(path, "/bridge.js") {
				bridges = append(bridges, path)
			}
		}
		if len(bridges) != 1 {
			return nil, Fail("RUNTIME_DECLARATION_INVALID")
		}
		resource.BridgeAssetPath = &bridges[0]
	}
	resources := []ResourcePlan{*resource}
	cue, err := cueResourcePlans(config, target, request)
	if err != nil {
		return nil, err
	}
	resources = append(resources, cue...)
	if flycast != nil {
		return append(resources, flycastResourcePlans(flycast, request.Files)...), nil
	}
	if parents := config.Core(coreID).Parents(); len(parents) > 0 {
		if input := targetInput(target, "parent"); input == nil || input.Kind != "EXTERNAL_FILE_SET" {
			return nil, Fail("RUNTIME_PARENT_INVALID")
		}
		resources = append(resources, ResourcePlan{
			Role: "parent", Kind: "EXTERNAL_FILE_SET", Files: parents,
			Paths: parentPaths(parents, request.Files),
		})
	}
	return resources, nil
}

func parentPaths(keys []string, files []File) map[string]string {
	paths := make(map[string]string, len(keys))
	for _, key := range keys {
		paths[key] = Lower(BaseName(FindFile(files, key).Name))
	}
	return paths
}

func targetInput(target *Target, role string) *Input {
	for index := range target.Inputs {
		if target.Inputs[index].Role == role {
			return &target.Inputs[index]
		}
	}
	return nil
}

func cueResourcePlans(config *Configuration, target *Target, request *PrepareRequest) ([]ResourcePlan, error) {
	if config.Content.Kind != "SINGLE_FILE" {
		return nil, nil
	}
	entryFile := *config.Content.EntryFile
	entry := FindFile(request.Files, entryFile)
	if entry == nil || !strings.HasSuffix(Lower(entry.Name), ".cue") {
		return nil, nil
	}
	if targetInput(target, "game-files") == nil {
		return nil, Fail("RUNTIME_CONTENT_UNSUPPORTED")
	}
	others := request.CueFiles
	if !request.CueKnown {
		others = nil
		for _, file := range request.Files {
			if file.LogicalKey != entryFile {
				others = append(others, file.LogicalKey)
			}
		}
	}
	for _, key := range others {
		if FindFile(request.Files, key) == nil || key == entryFile {
			return nil, Fail("RUNTIME_CUE_INVALID")
		}
	}
	if len(others) == 0 {
		return nil, nil
	}
	paths, err := projectPaths(others, entryFile)
	if err != nil {
		return nil, err
	}
	return []ResourcePlan{{Role: "game-files", Kind: "EXTERNAL_FILE_SET", Files: others, Paths: paths}}, nil
}

func flycastResourcePlans(flycast *FlycastResult, files []File) []ResourcePlan {
	keys := append(append([]string{}, flycast.ParentFiles...), flycast.MediaFiles...)
	if len(keys) == 0 {
		return nil
	}
	paths := parentPaths(flycast.ParentFiles, files)
	for key, path := range flycast.MediaPaths {
		paths[key] = path
	}
	return []ResourcePlan{{Role: "game-files", Kind: "EXTERNAL_FILE_SET", Files: keys, Paths: paths}}
}

func arcadeResourcePath(resource *ResourcePlan, config *Configuration, target *Target, coreID string, files []File,
) error {
	if config.Content.Kind != "ARCADE" || target.ROMSetSelection == nil ||
		target.ROMSetSelection.Driver != "CONTENT_BASENAME" {
		return nil
	}
	key := *config.Content.EntryFile
	file := FindFile(files, key)
	if file == nil || file.Name == "" {
		return Fail("RUNTIME_ENTRY_MISSING")
	}
	resource.Paths = map[string]string{key: ConfiguredMachine(coreID, config, file.Name) + ".zip"}
	return nil
}

var zipEncoding = "ZIP"

// projectResource delivers the entry's project tree; mapped trees and packed blobs use project-relative paths.
func projectResource(plan *ResourcePlan, content *Content, files []File, packed bool) (*ResourcePlan, error) {
	entry, hasEntry := content.Entry()
	root := Root(entry)
	mv := content.Kind == "RPG_MAKER_PROJECT" && *content.Engine == "RPGMV"
	for _, file := range files {
		if strings.HasPrefix(file.LogicalKey, root) || mv && rpgPluginScenarioPath(entry, file.LogicalKey) {
			plan.Files = append(plan.Files, file.LogicalKey)
		}
	}
	if plan.Kind == "FILE_TREE" || packed {
		paths, err := projectPaths(plan.Files, entry)
		if err != nil {
			return nil, err
		}
		plan.Paths = paths
		if hasEntry && entry != "" {
			mapped := paths[entry]
			plan.EntryFile = &mapped
		}
	}
	if packed {
		plan.Encoding = &zipEncoding
	}
	return plan, nil
}

func gameResource(kind string, config *Configuration, files []File, pspProject bool) (*ResourcePlan, error) {
	content := &config.Content
	entry, hasEntry := content.Entry()
	plan := &ResourcePlan{Role: "game", Kind: kind, Files: []string{}}
	if hasEntry && entry != "" {
		plan.EntryFile = &entry
	}
	if content.Kind == "DOS_BUNDLE" {
		plan.Files, plan.Paths = []string{entry}, map[string]string{entry: "game.zip"}
		return plan, nil
	}
	packed := kind == "SEEKABLE_BLOB" && (content.Kind == "RPG_MAKER_PROJECT" || pspProject)
	if kind == "FILE_TREE" || kind == "NATIVE_WEB" || kind == "ISOLATED_WEB" || packed {
		return projectResource(plan, content, files, packed)
	}
	if !hasEntry || entry == "" {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	plan.Files = []string{entry}
	return plan, nil
}

func projectPaths(keys []string, entry string) (map[string]string, error) {
	root := Root(entry)
	paths := make(map[string]string, len(keys))
	for _, key := range keys {
		if !strings.HasPrefix(key, root) {
			return nil, Fail("RUNTIME_PROJECT_PATH_INVALID")
		}
		paths[key] = key[len(root):]
	}
	return paths, nil
}
