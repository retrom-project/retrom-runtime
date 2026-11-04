package rules

import (
	"reflect"
	"regexp"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

var (
	cueFileLine = regexp.MustCompile(`(?i)^[` + jsSpace + `]*FILE[` + jsSpace + `]`)
	cueFileRule = regexp.MustCompile(`(?i)^[` + jsSpace + `]*FILE[` + jsSpace + `]+(?:"([^"]+)"|([^` + jsSpace +
		`]+))[` + jsSpace + `]+[^` + jsSpace + `]+[` + jsSpace + `]*$`)
	lineBreak = regexp.MustCompile(`\r?\n`)
)

// legacyCueReferences decodes the sheet with each supported legacy encoding, keeping distinct readings.
func legacyCueReferences(data []byte, entry string) [][]ContentReference {
	var candidates [][]ContentReference
	for _, encoding := range []string{"shift_jis", "gb18030"} {
		text, ok := textcodec.Decode(data, encoding, false)
		if !ok {
			continue
		}
		if references := cueReferences(text, entry); references != nil && !containsReferences(candidates, references) {
			candidates = append(candidates, references)
		}
	}
	return candidates
}

// CueContentReferences decodes a CUE sheet once; legacy names require unambiguous file evidence.
func CueContentReferences(data []byte, entry string, available []string) ([]ContentReference, error) {
	if len(data) > 1024*1024 || !LogicalPath(entry, false) {
		return nil, Fail("RUNTIME_CUE_INVALID")
	}
	bom := bomEncoding(data)
	label := bom
	if label == "" {
		label = "utf-8"
	}
	if text, ok := textcodec.Decode(data, label, false); ok || bom != "" {
		var references []ContentReference
		if ok {
			references = cueReferences(text, entry)
		}
		if references == nil {
			return nil, Fail("RUNTIME_CUE_INVALID")
		}
		return references, nil
	}
	candidates := legacyCueReferences(data, entry)
	switch len(candidates) {
	case 0:
		return nil, Fail("RUNTIME_CUE_INVALID")
	case 1:
		return candidates[0], nil
	}
	var complete [][]ContentReference
	for _, references := range candidates {
		if allResolved(references, available) {
			complete = append(complete, references)
		}
	}
	if len(complete) == 1 {
		return complete[0], nil
	}
	return nil, Fail("RUNTIME_CUE_ENCODING_REQUIRED", "entryFile", entry)
}

func containsReferences(candidates [][]ContentReference, references []ContentReference) bool {
	for _, candidate := range candidates {
		if reflect.DeepEqual(candidate, references) {
			return true
		}
	}
	return false
}

func allResolved(references []ContentReference, available []string) bool {
	for _, reference := range references {
		matches := 0
		for _, key := range available {
			if Lower(key) == Lower(reference.LogicalKey) {
				matches++
			}
		}
		if matches != 1 {
			return false
		}
	}
	return true
}

func bomEncoding(data []byte) string {
	switch {
	case len(data) >= 2 && data[0] == 0xff && data[1] == 0xfe:
		return "utf-16le"
	case len(data) >= 2 && data[0] == 0xfe && data[1] == 0xff:
		return "utf-16be"
	case len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf:
		return "utf-8"
	}
	return ""
}

func cueReferences(text, entry string) []ContentReference {
	root := Root(entry)
	var references []ContentReference
	for _, line := range lineBreak.Split(text, -1) {
		if !cueFileLine.MatchString(line) {
			continue
		}
		match := cueFileRule.FindStringSubmatch(line)
		name := ""
		if match != nil {
			name = match[1]
			if name == "" {
				name = match[2]
			}
		}
		if !LogicalPath(name, false) || !LogicalPath(root+name, false) {
			return nil
		}
		references = append(references, ContentReference{LogicalKey: root + name, RelativeTo: entry, RelativePath: name})
	}
	return references
}

// IdentifyPSXRegion reads only the disc's sector-four license, independently of a title or filename.
func IdentifyPSXRegion(systemArea []byte) *string {
	regions := map[string]bool{}
	for _, sectorBytes := range []int{2048, 2336, 2352} {
		start, end := 4*sectorBytes, 5*sectorBytes
		if start > len(systemArea) {
			start = len(systemArea)
		}
		if end > len(systemArea) {
			end = len(systemArea)
		}
		text, _ := textcodec.Decode(systemArea[start:end], "latin1", false)
		text = Lower(removeSpaces(text))
		const prefix = "licensedbysonycomputerentertainment"
		if strings.Contains(text, prefix+"america") {
			regions["US"] = true
		}
		if strings.Contains(text, prefix+"europe") {
			regions["EU"] = true
		}
		if strings.Contains(text, prefix+"inc") {
			regions["JP"] = true
		}
	}
	if len(regions) != 1 {
		return nil
	}
	for region := range regions {
		return &region
	}
	return nil
}

var jsSpaceRun = regexp.MustCompile(`[` + jsSpace + `]`)

func removeSpaces(text string) string { return jsSpaceRun.ReplaceAllString(text, "") }
