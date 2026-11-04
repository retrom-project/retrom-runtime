package rules

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
)

// File is an immutable content identity; storage paths remain host-owned.
type File struct {
	LogicalKey string  `json:"logicalKey"`
	Name       string  `json:"name"`
	SHA256     string  `json:"sha256"`
	SizeBytes  float64 `json:"sizeBytes"`
}

// Size returns the file size as an integer.
func (f *File) Size() int64 { return int64(f.SizeBytes) }

// FindFile returns the file with logical key.
func FindFile(files []File, key string) *File {
	for index := range files {
		if files[index].LogicalKey == key {
			return &files[index]
		}
	}
	return nil
}

func safeInteger(value float64) bool {
	return value == math.Trunc(value) && math.Abs(value) <= 1<<53-1
}

// ContentHash is the Game's content identity: a raw SHA for one file or the sorted tree hash.
func ContentHash(files []File, mode string) (string, error) {
	if len(files) == 0 || len(files) > 100_000 {
		return "", Fail("RUNTIME_CONTENT_INVALID")
	}
	keys := make(map[string]bool, len(files))
	for _, file := range files {
		if !LogicalPath(file.LogicalKey, false) || !LogicalPath(file.Name, false) || !Digest(file.SHA256) ||
			!safeInteger(file.SizeBytes) || file.SizeBytes < 0 || keys[file.LogicalKey] {
			return "", Fail("RUNTIME_CONTENT_INVALID")
		}
		keys[file.LogicalKey] = true
	}
	if mode == "FILE" {
		if len(files) != 1 {
			return "", Fail("RUNTIME_CONTENT_INVALID")
		}
		return files[0].SHA256, nil
	}
	sorted := append([]File(nil), files...)
	sort.SliceStable(sorted, func(i, j int) bool { return UTF8Compare(sorted[i].LogicalKey, sorted[j].LogicalKey) < 0 })
	entries := make([]any, 0, len(sorted))
	for _, file := range sorted {
		entries = append(entries, []any{file.LogicalKey, file.SizeBytes, file.SHA256})
	}
	return HashBytes(CanonicalJSON(entries)), nil
}

// HashBytes returns a lowercase SHA-256 digest.
func HashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Identity is the save-compatible runtime identity.
type Identity struct {
	CoreID          string `json:"coreId"`
	ProviderID      string `json:"providerId"`
	TargetID        string `json:"targetId"`
	CoreFingerprint string `json:"coreFingerprint"`
	ROMHash         string `json:"romHash"`
}

// SaveContext is frozen Save extinfo.
type SaveContext struct {
	Identity
	CheckpointFormat string         `json:"checkpointFormat"`
	RuntimeOptions   map[string]any `json:"runtimeOptions"`
	Content          any            `json:"content"`
	ROMSet           *string        `json:"romSet,omitempty"`
}

// Restorability is a Save restore decision.
type Restorability struct {
	Restorable bool    `json:"restorable"`
	Reason     *string `json:"reason"`
	Warning    *string `json:"warning"`
}

// RestoreInput is one restorability question.
type RestoreInput struct {
	GameAvailable bool      `json:"gameAvailable"`
	SaveAvailable bool      `json:"saveAvailable"`
	Current       *Identity `json:"current"`
	Context       struct {
		Identity
		CheckpointFormat string `json:"checkpointFormat"`
	} `json:"context"`
	ReadFormats []string `json:"readFormats"`
}

func refused(reason string) Restorability { return Restorability{Reason: &reason} }

// Restore decides whether a frozen Save can be restored on the current identity.
func Restore(input *RestoreInput) Restorability {
	if !input.GameAvailable {
		return refused("GAME_UNAVAILABLE")
	}
	if !input.SaveAvailable {
		return refused("SAVE_UNAVAILABLE")
	}
	current, saved := input.Current, input.Context
	if current == nil || current.CoreID != saved.CoreID || current.ProviderID != saved.ProviderID ||
		current.TargetID != saved.TargetID {
		return refused("CORE_UNAVAILABLE")
	}
	if current.ROMHash != saved.ROMHash {
		return refused("CONTENT_CHANGED")
	}
	if !contains(input.ReadFormats, saved.CheckpointFormat) {
		return refused("FORMAT_UNREADABLE")
	}
	result := Restorability{Restorable: true}
	if current.CoreFingerprint != saved.CoreFingerprint {
		warning := "CORE_CHANGED"
		result.Warning = &warning
	}
	return result
}
