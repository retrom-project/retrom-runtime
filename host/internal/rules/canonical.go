package rules

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// CanonicalJSON encodes integer-only JSON with UTF-16 sorted keys, as the Provider contract does.
func CanonicalJSON(value any) []byte {
	var builder strings.Builder
	writeCanonical(&builder, value)
	return []byte(builder.String())
}

func writeCanonicalArray(builder *strings.Builder, items []any) {
	builder.WriteByte('[')
	for index, item := range items {
		if index > 0 {
			builder.WriteByte(',')
		}
		writeCanonical(builder, item)
	}
	builder.WriteByte(']')
}

// writeCanonicalObject orders keys by UTF-16 code units, like a JavaScript default sort.
func writeCanonicalObject(builder *strings.Builder, object map[string]any) {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return UTF16Less(keys[i], keys[j]) })
	builder.WriteByte('{')
	for index, key := range keys {
		if index > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(JSONString(key))
		builder.WriteByte(':')
		writeCanonical(builder, object[key])
	}
	builder.WriteByte('}')
}

func writeCanonical(builder *strings.Builder, value any) {
	switch typed := value.(type) {
	case nil:
		builder.WriteString("null")
	case bool:
		builder.WriteString(strconv.FormatBool(typed))
	case string:
		builder.WriteString(JSONString(typed))
	case float64:
		if !safeInteger(typed) {
			panic(Fail("CANONICAL_JSON_INVALID"))
		}
		builder.WriteString(strconv.FormatInt(int64(typed), 10))
	case int:
		builder.WriteString(strconv.Itoa(typed))
	case int64:
		builder.WriteString(strconv.FormatInt(typed, 10))
	case []any:
		writeCanonicalArray(builder, typed)
	case []string:
		items := make([]any, len(typed))
		for index, item := range typed {
			items[index] = item
		}
		writeCanonicalArray(builder, items)
	case map[string]any:
		writeCanonicalObject(builder, typed)
	default:
		panic(Fail("CANONICAL_JSON_INVALID"))
	}
}

// JSONString mirrors JSON.stringify for a string.
func JSONString(value string) string {
	var builder strings.Builder
	builder.WriteByte('"')
	for _, character := range value {
		switch character {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if character < 0x20 {
				fmt.Fprintf(&builder, `\u%04x`, character)
			} else {
				builder.WriteRune(character)
			}
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

// CanonicalEqual compares two values by their canonical encoding.
func CanonicalEqual(left, right any) (bool, error) {
	first, err := canonicalBytes(left)
	if err != nil {
		return false, err
	}
	second, err := canonicalBytes(right)
	if err != nil {
		return false, err
	}
	return string(first) == string(second), nil
}

// canonicalBytes converts a raised canonicalization failure into an error.
func canonicalBytes(value any) ([]byte, error) {
	var encoded []byte
	var failure error
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				raised, ok := recovered.(*Failure)
				if !ok {
					panic(recovered)
				}
				failure = raised
			}
		}()
		encoded = CanonicalJSON(value)
	}()
	return encoded, failure
}
