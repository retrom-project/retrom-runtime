package rules

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type optionVector struct {
	Field string `json:"field"`
	Name  string `json:"name"`
	Valid bool   `json:"valid"`
}

// TestKirikiriOptionVectors asserts the vectors the browser adapter also asserts (src/kirikiri).
func TestKirikiriOptionVectors(t *testing.T) {
	encoded, err := os.ReadFile("../../../src/kirikiri/target-options.vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Vectors []map[string]any `json:"vectors"`
	}
	if err := json.Unmarshal(encoded, &document); err != nil || len(document.Vectors) == 0 {
		t.Fatalf("vectors: %v", err)
	}
	for _, raw := range document.Vectors {
		vector := optionVector{}
		vector.Field, _ = raw["field"].(string)
		vector.Name, _ = raw["name"].(string)
		vector.Valid, _ = raw["valid"].(bool)
		// Presence follows the options object: an explicit null is present and must be rejected.
		value, present := raw["value"]
		t.Run(vector.Field+": "+vector.Name, func(t *testing.T) {
			switch vector.Field {
			case "engineArguments":
				if valid := kirikiriEngineArguments(value, present); valid != vector.Valid {
					t.Fatalf("valid = %v, want %v", valid, vector.Valid)
				}
			case "overlayArchives":
				archives, valid := KirikiriOverlayArchives(value, present)
				if valid != vector.Valid {
					t.Fatalf("valid = %v, want %v", valid, vector.Valid)
				}
				if valid && present && !reflect.DeepEqual(toAny(archives), value) {
					t.Fatalf("archives = %v, want %v", archives, value)
				}
			default:
				t.Fatalf("unknown field %s", vector.Field)
			}
		})
	}
}

func toAny(values []string) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func TestOfficialRTPComesFromTheSharedFact(t *testing.T) {
	want := map[string]string{"RPGXP": "Standard", "RPGVX": "RPGVX", "RPGVXACE": "RPGVXAce"}
	if got := officialRTP(); !reflect.DeepEqual(got, want) {
		t.Fatalf("officialRTP = %v", got)
	}
}
