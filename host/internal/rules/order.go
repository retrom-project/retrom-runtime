package rules

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// ObjectKeys returns the members of a JSON object in JavaScript property order:
// array-index keys ascending, then string keys in source order.
func ObjectKeys(data []byte) ([]string, map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil {
		return nil, nil, fmt.Errorf("json object: %w", err)
	}
	if delimiter, ok := token.(json.Delim); !ok || delimiter != '{' {
		return nil, nil, Fail("RUNTIME_ARCADE_CATALOG_INVALID")
	}
	keys := []string{}
	values := map[string]json.RawMessage{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, nil, fmt.Errorf("json object: %w", err)
		}
		key, ok := token.(string)
		if !ok {
			return nil, nil, Fail("RUNTIME_ARCADE_CATALOG_INVALID")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, nil, fmt.Errorf("json object: %w", err)
		}
		if _, exists := values[key]; !exists {
			keys = append(keys, key)
		}
		values[key] = value
	}
	return JSOrder(keys), values, nil
}

// JSOrder sorts keys as JavaScript enumerates ordinary object properties.
func JSOrder(keys []string) []string {
	indexes, names := []string{}, []string{}
	for _, key := range keys {
		if arrayIndex(key) {
			indexes = append(indexes, key)
		} else {
			names = append(names, key)
		}
	}
	sort.SliceStable(indexes, func(i, j int) bool {
		left, _ := strconv.ParseUint(indexes[i], 10, 64)
		right, _ := strconv.ParseUint(indexes[j], 10, 64)
		return left < right
	})
	return append(indexes, names...)
}

func arrayIndex(key string) bool {
	value, err := strconv.ParseUint(key, 10, 64)
	return err == nil && value < 1<<32-1 && strconv.FormatUint(value, 10) == key
}
