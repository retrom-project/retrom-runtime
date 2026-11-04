package rules

import (
	"regexp"
	"strings"
)

var thomsonModels = [][2]string{
	{"to8d", "TO8D"},
	{"to8", "TO8"},
	{"to9p", "TO9+"},
	{"to9", "TO9"},
	{"to770", "TO7/70"},
	{"to7", "TO7"},
	{"mo6", "MO6"},
	{"pc128", "PC128"},
	{"mo5", "MO5"},
	{"memo5", "MO5"},
	{".m5", "MO5"},
	{"memo7", "TO8"},
	{".m7", "TO8"},
}

// thomsonModelOptions matches the pinned Theodore autodetect order on the resource basename.
func thomsonModelOptions(options map[string]any, entryFile string, files []File) map[string]any {
	if model, exists := options["thomsonModel"]; exists && model != "Auto" {
		return options
	}
	filename := ""
	if file := FindFile(files, entryFile); file != nil {
		filename = BaseName(file.Name)
	}
	model := "TO8"
	for _, candidate := range thomsonModels {
		if strings.Contains(filename, candidate[0]) || strings.Contains(filename, strings.ToUpper(candidate[0])) {
			model = candidate[1]
			break
		}
	}
	result := cloneObject(options)
	result["thomsonModel"] = model
	return result
}

func cloneObject(value map[string]any) map[string]any {
	result := make(map[string]any, len(value)+2)
	for key, item := range value {
		result[key] = item
	}
	return result
}

func siglusNames(files []File, entry string) map[string]bool {
	root := Lower(Root(entry))
	names := map[string]bool{}
	for _, file := range files {
		lower := Lower(file.LogicalKey)
		if strings.HasPrefix(lower, root) {
			names[lower[len(root):]] = true
		}
	}
	return names
}

func validateSiglusOptions(config *Configuration, target *Target, options map[string]any, files []File) error {
	if target.ID != "siglus" || config.Content.Kind != "SIGLUS_PROJECT" {
		return nil
	}
	names := siglusNames(files, *config.Content.EntryFile)
	if !names["gameexe.dat"] && !names["gameexe.ini"] {
		return Fail("RUNTIME_ENTRY_MISSING")
	}
	if options["language"] == "chs" && (!names["scene.chs"] || !names["gameexe.chs"]) {
		return Fail("RUNTIME_SIGLUS_TRANSLATION_MISSING")
	}
	return nil
}

// pspProjectEntry: a PBP may be an entry into a content tree, while a lone disc stays seekable.
func pspProjectEntry(config *Configuration, files []File) (string, bool) {
	entry, ok := config.Content.Entry()
	if ok && HasSuffixFold(entry, ".pbp") && len(files) > 1 {
		return BaseName(entry), true
	}
	return "", false
}

// jsSpace is the JavaScript \s class.
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

var (
	kirikiriArgument = regexp.MustCompile(`^-[^` + jsSpace + `=]+(?:=.*)?$`)
	xp3Suffix        = regexp.MustCompile(`(?i)\.xp3$`)
)

// kirikiriEngineArguments validates native engine arguments; entry and storage stay owned by public options.
func kirikiriEngineArguments(value any, present bool) bool {
	if !present {
		return true
	}
	items, ok := value.([]any)
	if !ok || len(items) > 64 {
		return false
	}
	for _, item := range items {
		text, isText := item.(string)
		if !isText || UTF16Length(text) > 1024 || !kirikiriArgument.MatchString(jsMultiline(text)) || hasControl(text) {
			return false
		}
		name := Lower(strings.SplitN(text, "=", 2)[0])
		if name == "-datapath" || name == "-startup" {
			return false
		}
	}
	return true
}

// jsMultiline makes "." reject line terminators as JavaScript does without the s flag.
func jsMultiline(text string) string {
	if strings.ContainsAny(text, "\n\r\u2028\u2029") {
		return "\x00invalid"
	}
	return text
}

func hasControl(text string) bool {
	for _, character := range text {
		if character < 32 || character == 127 {
			return true
		}
	}
	return false
}

// KirikiriOverlayArchives validates explicitly ordered overlay archive paths.
func KirikiriOverlayArchives(value any, present bool) ([]string, bool) {
	if !present {
		return []string{}, true
	}
	items, ok := value.([]any)
	if !ok || len(items) > 32 {
		return nil, false
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		path, isText := item.(string)
		if !isText || !canonicalPath(path) || UTF16Length(path) > 240 || strings.Contains(path, ">") ||
			!xp3Suffix.MatchString(path) || contains(result, path) {
			return nil, false
		}
		result = append(result, path)
	}
	return result, true
}

func prepareKirikiriOptions(config *Configuration, options map[string]any, files []File) (map[string]any, error) {
	if config.Content.Kind != "KIRIKIRI_PROJECT" {
		return nil, Invalid()
	}
	entryFile := *config.Content.EntryFile
	arguments, hasArguments := options["engineArguments"]
	overlays, hasOverlays := options["overlayArchives"]
	archives, validOverlays := KirikiriOverlayArchives(overlays, hasOverlays)
	valid := kirikiriEngineArguments(arguments, hasArguments) && validOverlays
	root := Root(entryFile)
	for _, path := range archives {
		valid = valid && FindFile(files, root+path) != nil
	}
	if !valid {
		return nil, Fail("RUNTIME_OPTIONS_INVALID", "coreId", "kirikiri2")
	}
	result := cloneObject(options)
	if regexp.MustCompile(`(?i)(?:^|/)startup\.tjs$`).MatchString(entryFile) {
		result["startupXp3Path"] = nil
	} else {
		result["startupXp3Path"] = entryFile[len(root):]
	}
	return result, nil
}

// rpgPluginScenarioPath: desktop MV packages can place plugin scenario scripts next to their www directory.
func rpgPluginScenarioPath(entry, path string) bool {
	root := Root(entry)
	if HasSuffixFold(root, "www/") {
		root = root[:len(root)-4]
	}
	return strings.HasPrefix(path, root+"scenario/") && (HasSuffixFold(path, ".sl") || HasSuffixFold(path, ".txt"))
}
