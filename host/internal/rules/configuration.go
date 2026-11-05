package rules

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sync"

	retromruntime "github.com/retrom-project/retrom-runtime"
)

// errFactsInvalid reports an embedded runtime fact that cannot be decoded, which is a build defect.
var errFactsInvalid = errors.New("runtime fact invalid")

// Content is the runtime content rule of a Game.
type Content struct {
	Kind      string  `json:"kind"`
	EntryFile *string `json:"entryFile,omitempty"`
	EntryPath *string `json:"entryPath,omitempty"`
	Engine    *string `json:"engine,omitempty"`
	RTP       *string `json:"rtp,omitempty"`
}

// Entry returns the entry file and whether the content kind has one.
func (c *Content) Entry() (string, bool) {
	if c.EntryFile == nil {
		return "", false
	}
	return *c.EntryFile, true
}

// CoreConfiguration holds one core's game-specific options.
type CoreConfiguration struct {
	ParentFiles *[]string       `json:"parentFiles,omitempty"`
	Options     *map[string]any `json:"options,omitempty"`
	ROMSet      *string         `json:"romSet,omitempty"`
}

// Parents returns configured Parent logical keys.
func (c *CoreConfiguration) Parents() []string {
	if c == nil || c.ParentFiles == nil {
		return nil
	}
	return *c.ParentFiles
}

// Configuration is a validated Game runtime configuration.
type Configuration struct {
	Content Content                        `json:"content"`
	Cores   *map[string]*CoreConfiguration `json:"cores,omitempty"`
}

// Core returns one core configuration or nil.
func (c *Configuration) Core(id string) *CoreConfiguration {
	if c.Cores == nil {
		return nil
	}
	return (*c.Cores)[id]
}

// CoreIDs returns configured core IDs in JavaScript property order.
func (c *Configuration) CoreIDs() []string {
	if c.Cores == nil {
		return nil
	}
	keys := make([]string, 0, len(*c.Cores))
	for key := range *c.Cores {
		keys = append(keys, key)
	}
	sortStrings(keys)
	return keys
}

// Clone returns a deep copy.
func (c *Configuration) Clone() *Configuration {
	encoded, err := json.Marshal(c)
	if err != nil {
		panic(err)
	}
	var clone Configuration
	if err := json.Unmarshal(encoded, &clone); err != nil {
		panic(err)
	}
	return &clone
}

var (
	entryKinds = []string{
		"SINGLE_FILE", "ARCADE", "ONS_PROJECT", "KIRIKIRI_PROJECT", "BUTTERSCOTCH_PROJECT",
		"TYRANOSCRIPT_PROJECT", "NXENGINE_PROJECT", "DAPHNE_PROJECT", "SIGLUS_PROJECT",
	}
	engines       = []string{"RPG2000", "RPG2003", "RPGXP", "RPGVX", "RPGVXACE", "RPGMV", "RPGMZ"}
	romSetPattern = regexp.MustCompile(`^[a-z0-9_]{1,128}$`)
	// officialRTP is the run time package each RGSS engine's own installer provides, from the shared runtime fact.
	officialRTP = sync.OnceValue(loadOfficialRTP)
)

func loadOfficialRTP() map[string]string {
	data, err := retromruntime.Facts.ReadFile("src/runtime/rpg-rtp.json")
	var table map[string]string
	if err == nil {
		err = json.Unmarshal(data, &table)
	}
	if err != nil || len(table) == 0 {
		panic(fmt.Errorf("%w: rpg-rtp.json", errFactsInvalid))
	}
	return table
}

// ParseConfiguration accepts only game-specific rules.
func ParseConfiguration(value any) (*Configuration, error) {
	object, ok := Object(value)
	if !ok || !Exact(object, []string{"content"}, "cores") {
		return nil, Invalid()
	}
	content, err := parseContent(object["content"])
	if err != nil {
		return nil, err
	}
	config := &Configuration{Content: *content}
	if raw, exists := object["cores"]; exists {
		cores, ok := Object(raw)
		if !ok || len(cores) > 128 {
			return nil, Invalid()
		}
		parsed := make(map[string]*CoreConfiguration, len(cores))
		for _, coreID := range JSOrder(mapKeys(cores)) {
			core, err := parseCore(coreID, cores[coreID], content)
			if err != nil {
				return nil, err
			}
			parsed[coreID] = core
		}
		config.Cores = &parsed
	}
	return config, nil
}

func parseCore(coreID string, raw any, content *Content) (*CoreConfiguration, error) {
	core, ok := Object(raw)
	if !Identifier(coreID) || !ok || !Exact(core, nil, "parentFiles", "options", "romSet") {
		return nil, Invalid()
	}
	result := &CoreConfiguration{}
	if value, exists := core["romSet"]; exists {
		text, isText := value.(string)
		if content.Kind != "ARCADE" || !isText || !romSetPattern.MatchString(text) {
			return nil, Fail("RUNTIME_ROM_SET_INVALID")
		}
		result.ROMSet = &text
	}
	if value, exists := core["options"]; exists {
		options, isObject := Object(value)
		if !isObject {
			return nil, Invalid()
		}
		result.Options = &options
	}
	if value, exists := core["parentFiles"]; exists {
		parents, err := parentFiles(value, content)
		if err != nil {
			return nil, err
		}
		result.ParentFiles = &parents
	}
	return result, nil
}

func parentFiles(value any, content *Content) ([]string, error) {
	items, ok := value.([]any)
	if (content.Kind != "ARCADE" && content.Kind != "SINGLE_FILE") || !ok || len(items) > 32 {
		return nil, Invalid()
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		text, isText := item.(string)
		if !isText || !LogicalPath(text, false) || contains(result, text) {
			return nil, Invalid()
		}
		result = append(result, text)
	}
	return result, nil
}

func parseDOSContent(object map[string]any, content *Content) error {
	entryPath, hasPath := object["entryPath"]
	if !Exact(object, []string{"kind", "entryFile"}, "entryPath") || !LogicalPath(object["entryFile"], false) ||
		hasPath && !LogicalPath(entryPath, false) {
		return Invalid()
	}
	if hasPath {
		content.EntryPath = stringPointer(entryPath)
	}
	return nil
}

func parseContent(value any) (*Content, error) {
	object, ok := Object(value)
	kind, isText := object["kind"].(string)
	if !ok || !isText {
		return nil, Invalid()
	}
	content := &Content{Kind: kind}
	switch kind {
	case "SCUMMVM_PROJECT":
		if !Exact(object, []string{"kind"}) {
			return nil, Invalid()
		}
	case "DOS_BUNDLE":
		if err := parseDOSContent(object, content); err != nil {
			return nil, err
		}
	case "RPG_MAKER_PROJECT":
		if err := validateRPGContent(object); err != nil {
			return nil, err
		}
		content.Engine = stringPointer(object["engine"])
		if rtp, exists := object["rtp"]; exists {
			content.RTP = stringPointer(rtp)
		}
	default:
		if !contains(entryKinds, kind) || !Exact(object, []string{"kind", "entryFile"}) ||
			!LogicalPath(object["entryFile"], false) {
			return nil, Invalid()
		}
	}
	if kind != "SCUMMVM_PROJECT" {
		content.EntryFile = stringPointer(object["entryFile"])
	}
	return content, nil
}

func validateRPGContent(object map[string]any) error {
	engine, _ := object["engine"].(string)
	if !Exact(object, []string{"kind", "entryFile", "engine"}, "rtp") || !LogicalPath(object["entryFile"], false) ||
		!contains(engines, jsString(object["engine"])) {
		return Invalid()
	}
	if rtp, exists := object["rtp"]; exists {
		official, rgss := officialRTP()[engine]
		if text, ok := rtp.(string); !rgss || !ok || text != official {
			return Invalid()
		}
	}
	return nil
}

// jsString approximates String(value) for the scalar values compared against identifiers.
func jsString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case nil:
		return "null"
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

func stringPointer(value any) *string {
	text, _ := value.(string)
	return &text
}

// ValidateConfigurationFiles checks that entry and Parent references exist in the Game's files.
func ValidateConfigurationFiles(config *Configuration, files []File) error {
	paths := make(map[string]bool, len(files))
	for _, file := range files {
		paths[file.LogicalKey] = true
	}
	if entry, ok := config.Content.Entry(); ok && !paths[entry] {
		return Fail("RUNTIME_ENTRY_MISSING", "logicalKey", entry)
	}
	if config.Content.Kind == "RPG_MAKER_PROJECT" && !contains(RPGEntryFiles(*config.Content.Engine, files),
		*config.Content.EntryFile) {
		return Fail("RUNTIME_RPG_ENTRY_INVALID", "logicalKey", *config.Content.EntryFile)
	}
	for _, coreID := range config.CoreIDs() {
		for _, path := range config.Core(coreID).Parents() {
			if !paths[path] {
				return Fail("RUNTIME_PARENT_MISSING", "logicalKey", path)
			}
		}
	}
	return nil
}

var rpgEntryNames = map[string]string{
	"RPGMV": "index.html", "RPGMZ": "index.html", "RPGXP": "game.ini", "RPGVX": "game.ini", "RPGVXACE": "game.ini",
	"RPG2000": "rpg_rt.ldb", "RPG2003": "rpg_rt.ldb",
}

// RPGEntryFiles lists entry paths relative to their project; unrelated HTML pages are not entries.
func RPGEntryFiles(engine string, files []File) []string {
	paths := make(map[string]bool, len(files))
	for _, file := range files {
		paths[Lower(file.LogicalKey)] = true
	}
	result := []string{}
	for _, file := range files {
		lower := Lower(file.LogicalKey)
		root := Root(lower)
		if !LogicalPath(file.LogicalKey, false) || lower[len(root):] != rpgEntryNames[engine] {
			continue
		}
		script := ""
		switch engine {
		case "RPGMV":
			script = "js/rpg_core.js"
		case "RPGMZ":
			script = "js/rmmz_core.js"
		}
		if script != "" && !paths[root+script] {
			continue
		}
		result = append(result, file.LogicalKey)
	}
	sortUTF8(result)
	return result
}

func mapKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sortStrings(keys)
	return keys
}
