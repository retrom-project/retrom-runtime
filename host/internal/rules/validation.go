// Package rules implements the host-agnostic runtime configuration, identity and preparation rules.
package rules

import (
	"bytes"
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// Failure is a stable runtime reason code with optional safe details.
type Failure struct {
	Code    string
	Details map[string]string
}

func (f *Failure) Error() string { return f.Code }

// Fail returns a runtime failure for code with optional key/value details.
func Fail(code string, details ...string) *Failure {
	failure := &Failure{Code: code}
	if len(details) > 0 {
		failure.Details = make(map[string]string, len(details)/2)
		for index := 0; index+1 < len(details); index += 2 {
			failure.Details[details[index]] = details[index+1]
		}
	}
	return failure
}

// Invalid is the generic configuration failure.
func Invalid() *Failure { return Fail("RUNTIME_CONFIGURATION_INVALID") }

var (
	identifierPattern = regexp.MustCompile(`^[a-z0-9]+(?:[-_][a-z0-9]+)*$`)
	digestPattern     = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

// Object reports whether value is a JSON object.
func Object(value any) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	return object, ok && object != nil
}

// Exact reports whether object has every required key and only required or optional keys.
func Exact(object map[string]any, required []string, optional ...string) bool {
	for _, key := range required {
		if _, exists := object[key]; !exists {
			return false
		}
	}
	for key := range object {
		if !contains(required, key) && !contains(optional, key) {
			return false
		}
	}
	return true
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// Identifier reports the runtime core/platform identifier grammar.
func Identifier(value any) bool {
	text, ok := value.(string)
	return ok && identifierPattern.MatchString(text) && len(text) <= 64
}

// Digest reports a lowercase SHA-256 hex digest.
func Digest(value any) bool {
	text, ok := value.(string)
	return ok && digestPattern.MatchString(text)
}

// UTF16Length is the JavaScript string length.
func UTF16Length(value string) int {
	length := 0
	for _, character := range value {
		if character >= 0x10000 {
			length += 2
		} else {
			length++
		}
	}
	return length
}

// LogicalPath reports the relative logical path grammar; empty is accepted only when allowed.
func LogicalPath(value any, empty bool) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	if empty && text == "" {
		return true
	}
	if text == "" || UTF16Length(text) > 4096 || strings.Contains(text, `\`) || !utf8.ValidString(text) {
		return false
	}
	for _, character := range text {
		if character < 32 || character == 127 {
			return false
		}
	}
	for _, segment := range strings.Split(text, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

// SafePath is the host archive path grammar used for project members.
func SafePath(text string) bool {
	if text == "" || UTF16Length(text) > 4096 || strings.HasPrefix(text, "/") || strings.Contains(text, `\`) {
		return false
	}
	for _, character := range text {
		if character < 32 || character == 127 {
			return false
		}
	}
	for _, part := range strings.Split(text, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

// UTF8Compare orders strings by their UTF-8 bytes.
func UTF8Compare(left, right string) int { return bytes.Compare([]byte(left), []byte(right)) }

// UTF16Less mirrors the JavaScript relational string comparison.
func UTF16Less(left, right string) bool {
	a, b := utf16.Encode([]rune(left)), utf16.Encode([]rune(right))
	for index := 0; index < len(a) && index < len(b); index++ {
		if a[index] != b[index] {
			return a[index] < b[index]
		}
	}
	return len(a) < len(b)
}

// Lower mirrors String.prototype.toLowerCase for the characters that differ from Go's simple mapping.
func Lower(value string) string {
	if !strings.ContainsAny(value, "İΣ") {
		return strings.ToLower(value)
	}
	var builder strings.Builder
	runes := []rune(value)
	for index, character := range runes {
		switch character {
		case 'İ':
			builder.WriteString("i̇")
		case 'Σ':
			builder.WriteRune(finalSigma(runes, index))
		default:
			builder.WriteString(strings.ToLower(string(character)))
		}
	}
	return builder.String()
}

// Upper mirrors String.prototype.toUpperCase, including unconditional special casing such as ß to SS.
func Upper(value string) string {
	for index := range len(value) {
		if value[index] >= utf8.RuneSelf {
			// A Caser is stateful; each call owns its own.
			return cases.Upper(language.Und).String(value)
		}
	}
	return strings.ToUpper(value)
}

func finalSigma(runes []rune, index int) rune {
	before := index > 0 && isLetter(runes[index-1])
	after := index+1 < len(runes) && isLetter(runes[index+1])
	if before && !after {
		return 'ς'
	}
	return 'σ'
}

func isLetter(character rune) bool {
	return strings.ToLower(string(character)) != strings.ToUpper(string(character))
}

// BaseName returns the last slash-separated segment.
func BaseName(name string) string {
	return name[strings.LastIndex(name, "/")+1:]
}

// Root returns the entry directory prefix including its trailing slash.
func Root(entry string) string {
	return entry[:strings.LastIndex(entry, "/")+1]
}

// ArchiveID is the lowercase ZIP basename without its .zip extension.
func ArchiveID(name string) string {
	base := BaseName(name)
	if len(base) >= 4 && strings.EqualFold(base[len(base)-4:], ".zip") {
		base = base[:len(base)-4]
	}
	return Lower(base)
}

// HasSuffixFold reports a case-insensitive ASCII suffix.
func HasSuffixFold(value, suffix string) bool {
	return len(value) >= len(suffix) && strings.EqualFold(value[len(value)-len(suffix):], suffix)
}
