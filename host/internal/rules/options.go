package rules

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
)

// ValidateTargetOptions checks options against a Target options schema and returns them unchanged.
func ValidateTargetOptions(value any, schema map[string]any) (map[string]any, error) {
	options, ok := Object(value)
	if !ok || !jsonRecord(options) || encodedLength(options) > 16*1024 || !validOption(options, schema, 0) {
		return nil, Fail("PROVIDER_LAUNCH_REQUEST_INVALID")
	}
	return options, nil
}

func encodedLength(value any) int {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return math.MaxInt
	}
	// The encoder escapes U+2028/U+2029 as six bytes where JSON.stringify writes three.
	text := strings.TrimSuffix(buffer.String(), "\n")
	separators := strings.Count(text, `\u2028`) + strings.Count(text, `\u2029`)
	return len(text) - 3*separators
}

func jsonRecord(value map[string]any) bool {
	return len(value) <= 64 && jsonValue(value, 0)
}

func jsonValue(value any, depth int) bool {
	if depth > 8 {
		return false
	}
	switch typed := value.(type) {
	case nil, bool, string:
		return true
	case float64:
		return safeInteger(typed)
	case []any:
		if len(typed) > 256 {
			return false
		}
		for _, item := range typed {
			if !jsonValue(item, depth+1) {
				return false
			}
		}
		return true
	case map[string]any:
		if len(typed) > 64 {
			return false
		}
		for _, item := range typed {
			if !jsonValue(item, depth+1) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func validOption(value any, schema map[string]any, depth int) bool {
	if depth > 8 {
		return false
	}
	types, nullable := schema["type"].([]any)
	if value == nil {
		return nullable
	}
	kind := ""
	if nullable && len(types) > 0 {
		kind = jsString(types[0])
	} else {
		kind = jsString(schema["type"])
	}
	switch kind {
	case "object":
		return validObjectOption(value, schema, depth)
	case "array":
		return validArrayOption(value, schema, depth)
	case "string":
		return validStringOption(value, schema)
	case "integer":
		return validIntegerOption(value, schema)
	case "boolean":
		_, ok := value.(bool)
		return ok
	default:
		return false
	}
}

func validObjectOption(value any, schema map[string]any, depth int) bool {
	object, ok := Object(value)
	if !ok {
		return false
	}
	properties, _ := schema["properties"].(map[string]any)
	required, _ := schema["required"].([]any)
	for key := range object {
		if _, exists := properties[key]; !exists {
			return false
		}
	}
	for _, key := range required {
		if _, exists := object[jsString(key)]; !exists {
			return false
		}
	}
	for key, item := range object {
		property, _ := properties[key].(map[string]any)
		if !validOption(item, property, depth+1) {
			return false
		}
	}
	return true
}

func number(value any, fallback float64) float64 {
	if typed, ok := value.(float64); ok {
		return typed
	}
	return fallback
}

func validArrayOption(value any, schema map[string]any, depth int) bool {
	items, ok := value.([]any)
	if !ok || float64(len(items)) < number(schema["minItems"], 0) ||
		float64(len(items)) > number(schema["maxItems"], math.NaN()) {
		return false
	}
	itemSchema, _ := schema["items"].(map[string]any)
	for _, item := range items {
		if !validOption(item, itemSchema, depth+1) {
			return false
		}
	}
	return true
}

func validStringOption(value any, schema map[string]any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	length := float64(len([]rune(text)))
	if length < number(schema["minLength"], 0) || length > number(schema["maxLength"], 4096) {
		return false
	}
	if allowed, isList := schema["enum"].([]any); isList && !containsValue(allowed, text) {
		return false
	}
	return schema["format"] != "safe-path" || providerSafePath(text)
}

func containsValue(values []any, value string) bool {
	for _, item := range values {
		if text, ok := item.(string); ok && text == value {
			return true
		}
	}
	return false
}

func validIntegerOption(value any, schema map[string]any) bool {
	typed, ok := value.(float64)
	return ok && safeInteger(typed) && typed >= number(schema["minimum"], -(1<<53-1)) &&
		typed <= number(schema["maximum"], 1<<53-1)
}

// providerSafePath is the Provider module safe-path grammar, bounded to 240 UTF-16 units.
func providerSafePath(text string) bool {
	if text == "" || UTF16Length(text) > 240 || strings.HasPrefix(text, "/") || strings.Contains(text, `\`) {
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
