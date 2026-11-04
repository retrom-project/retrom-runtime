package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

const scummvmDetector = "assets/scummvm/native/linux-x86_64/scummvm-detector"

type integrityDocument struct {
	Files []struct {
		Path      string `json:"path"`
		SizeBytes int64  `json:"sizeBytes"`
		SHA256    string `json:"sha256"`
	} `json:"files"`
}

func verifiedProviderFile(root string, integrity *integrityDocument, path string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(root, path))
	if err != nil {
		return nil, rules.Fail("RUNTIME_DETECTOR_INTEGRITY_FAILED")
	}
	for _, proof := range integrity.Files {
		if proof.Path == path {
			if proof.SizeBytes != int64(len(data)) || proof.SHA256 != content.SHA256(data) {
				break
			}
			return data, nil
		}
	}
	return nil, rules.Fail("RUNTIME_DETECTOR_INTEGRITY_FAILED")
}

func (s *Service) detectScummvm(ctx context.Context, input json.RawMessage) (any, error) {
	var value struct {
		ProviderRoot string `json:"providerRoot"`
		TreeRoot     string `json:"treeRoot"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	return detect(ctx, value.ProviderRoot, value.TreeRoot)
}

func detect(ctx context.Context, providerRoot, treeRoot string) (any, error) {
	if !strings.HasPrefix(providerRoot, "/") || !strings.HasPrefix(treeRoot, "/") {
		return nil, rules.Fail("RUNTIME_DETECTION_INPUT_INVALID")
	}
	encoded, err := os.ReadFile(filepath.Join(providerRoot, "integrity.json"))
	if err != nil {
		return nil, fmt.Errorf("scummvm integrity: %w", err)
	}
	var integrity integrityDocument
	if err := json.Unmarshal(encoded, &integrity); err != nil {
		return nil, fmt.Errorf("scummvm integrity: %w", err)
	}
	detector, err := verifiedProviderFile(providerRoot, &integrity, scummvmDetector)
	if err != nil {
		return nil, err
	}
	manifestBytes, err := verifiedProviderFile(providerRoot, &integrity, "assets/scummvm/manifest.json")
	if err != nil {
		return nil, err
	}
	var manifest struct {
		UpstreamCommit string                     `json:"upstreamCommit"`
		Engines        map[string]json.RawMessage `json:"engines"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, fmt.Errorf("scummvm manifest: %w", err)
	}
	if err := checkTree(treeRoot); err != nil {
		return nil, err
	}
	output, err := runDetector(ctx, detector, treeRoot)
	if err != nil {
		return nil, err
	}
	return detectionResult(output, manifest.UpstreamCommit, manifest.Engines)
}

func checkTree(root string) error {
	count := 0
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("scummvm tree: %w", err)
		}
		if path == root {
			return nil
		}
		count++
		if count > 100000 || entry.Type()&fs.ModeSymlink != 0 || !entry.IsDir() && !entry.Type().IsRegular() {
			return rules.Fail("RUNTIME_DETECTION_INPUT_INVALID")
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("scummvm tree: %w", err)
	}
	return nil
}

func runDetector(ctx context.Context, detector []byte, treeRoot string) ([]byte, error) {
	temporary, err := os.MkdirTemp("", "retrom-runtime-detect-")
	if err != nil {
		return nil, fmt.Errorf("scummvm workspace: %w", err)
	}
	defer func() { _ = os.RemoveAll(temporary) }()
	tool := filepath.Join(temporary, "scummvm-detector")
	if err := os.WriteFile(tool, detector, 0o700); err != nil {
		return nil, fmt.Errorf("scummvm detector: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, tool, "--config=/dev/null", "--retrom-detect", "--recursive",
		"--path="+treeRoot, "--savepath="+temporary)
	command.Dir = temporary
	command.Env = []string{"LANG=C.UTF-8", "HOME=" + temporary, "XDG_CONFIG_HOME=" + temporary}
	var stdout bytes.Buffer
	command.Stdout = &limitedWriter{buffer: &stdout, limit: 16 * 1024 * 1024}
	if err := command.Run(); err != nil {
		return nil, fmt.Errorf("scummvm detector: %w", err)
	}
	return stdout.Bytes(), nil
}

type limitedWriter struct {
	buffer *bytes.Buffer
	limit  int
}

func (w *limitedWriter) Write(data []byte) (int, error) {
	if w.buffer.Len()+len(data) > w.limit {
		return 0, rules.Fail("RUNTIME_DETECTION_RESULT_INVALID")
	}
	written, err := w.buffer.Write(data)
	if err != nil {
		return written, fmt.Errorf("scummvm output: %w", err)
	}
	return written, nil
}

type detectorCandidate struct {
	EngineID        json.RawMessage `json:"engineId"`
	GameID          json.RawMessage `json:"gameId"`
	Root            json.RawMessage `json:"root"`
	Language        json.RawMessage `json:"language"`
	Platform        json.RawMessage `json:"platform"`
	Extra           json.RawMessage `json:"extra"`
	GUIOptions      json.RawMessage `json:"guiOptions"`
	Description     any             `json:"description"`
	HasUnknownFiles any             `json:"hasUnknownFiles"`
	CanBeAdded      any             `json:"canBeAdded"`
	IsAddOn         any             `json:"isAddOn"`
	SupportLevel    any             `json:"supportLevel"`
	Config          *struct {
		Filename json.RawMessage `json:"filename"`
	} `json:"config"`
}

// truthy mirrors JavaScript truthiness for JSON values.
func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case float64:
		return typed != 0
	case string:
		return typed != ""
	default:
		return true
	}
}

// candidateBlocker is the reason a detected variant cannot be added, or nil.
func candidateBlocker(candidate *detectorCandidate, engines map[string]json.RawMessage) any {
	var engine string
	_ = json.Unmarshal(candidate.EngineID, &engine)
	_, available := engines[engine]
	switch {
	case truthy(candidate.HasUnknownFiles):
		return "UNKNOWN_VARIANT"
	case !truthy(candidate.CanBeAdded) || truthy(candidate.IsAddOn) || candidate.SupportLevel == 3.0:
		return "UNSUPPORTED_GAME"
	case !available:
		return "ENGINE_UNAVAILABLE"
	}
	return nil
}

func detectionResult(output []byte, upstream string, engines map[string]json.RawMessage) (any, error) {
	var document struct {
		SchemaVersion  any                  `json:"schemaVersion"`
		UpstreamCommit any                  `json:"upstreamCommit"`
		Error          any                  `json:"error"`
		Candidates     *[]detectorCandidate `json:"candidates"`
	}
	if err := json.Unmarshal(output, &document); err != nil {
		return nil, fmt.Errorf("scummvm result: %w", err)
	}
	if document.SchemaVersion != 1.0 || document.UpstreamCommit != upstream || document.Error != nil ||
		document.Candidates == nil || len(*document.Candidates) > 4096 {
		return nil, rules.Fail("RUNTIME_DETECTION_RESULT_INVALID")
	}
	candidates := make([]map[string]any, 0, len(*document.Candidates))
	for _, candidate := range *document.Candidates {
		filename := json.RawMessage("null")
		if candidate.Config != nil && candidate.Config.Filename != nil && string(candidate.Config.Filename) != "null" {
			filename = candidate.Config.Filename
		}
		options := []json.RawMessage{
			candidate.EngineID, candidate.GameID, candidate.Root, candidate.Language,
			candidate.Platform, candidate.Extra, candidate.GUIOptions, filename,
		}
		blocker := candidateBlocker(&candidate, engines)
		encoded, err := stringifyOptions(options)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, map[string]any{
			"id": content.SHA256(encoded), "description": candidate.Description,
			"options": json.RawMessage(encoded), "blocker": blocker,
		})
	}
	var automatic any
	if len(candidates) == 1 && candidates[0]["blocker"] == nil {
		automatic = candidates[0]["id"]
	}
	return map[string]any{"candidates": candidates, "automaticSelection": automatic}, nil
}

var optionNames = []string{"engineId", "gameId", "root", "language", "platform", "extra", "guiOptions", "filename"}

// stringifyOptions encodes with JSON.stringify key order, omitting absent (undefined) values.
func stringifyOptions(values []json.RawMessage) ([]byte, error) {
	var buffer bytes.Buffer
	buffer.WriteByte('{')
	written := 0
	for index, name := range optionNames {
		if values[index] == nil {
			continue
		}
		encoded, err := stringifyRaw(values[index])
		if err != nil {
			return nil, err
		}
		if written > 0 {
			buffer.WriteByte(',')
		}
		written++
		buffer.WriteString(rules.JSONString(name))
		buffer.WriteByte(':')
		buffer.Write(encoded)
	}
	buffer.WriteByte('}')
	return buffer.Bytes(), nil
}

// stringifyRaw re-encodes a JSON value as JSON.stringify does after JSON.parse, keeping property order.
func stringifyRaw(raw json.RawMessage) ([]byte, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, rules.Fail("RUNTIME_DETECTION_RESULT_INVALID")
	}
	switch trimmed[0] {
	case '{':
		return stringifyObject(trimmed)
	case '[':
		return stringifyArray(trimmed)
	}
	var value any
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return nil, rules.Fail("RUNTIME_DETECTION_RESULT_INVALID")
	}
	if text, ok := value.(string); ok {
		return []byte(rules.JSONString(text)), nil
	}
	return marshal(value)
}

// stringifyObject keeps JavaScript property order.
func stringifyObject(raw json.RawMessage) ([]byte, error) {
	keys, values, err := rules.ObjectKeys(raw)
	if err != nil {
		return nil, rules.Fail("RUNTIME_DETECTION_RESULT_INVALID")
	}
	var buffer bytes.Buffer
	buffer.WriteByte('{')
	for index, key := range keys {
		encoded, err := stringifyRaw(values[key])
		if err != nil {
			return nil, err
		}
		if index > 0 {
			buffer.WriteByte(',')
		}
		buffer.WriteString(rules.JSONString(key) + ":")
		buffer.Write(encoded)
	}
	buffer.WriteByte('}')
	return buffer.Bytes(), nil
}

func stringifyArray(raw json.RawMessage) ([]byte, error) {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, rules.Fail("RUNTIME_DETECTION_RESULT_INVALID")
	}
	var buffer bytes.Buffer
	buffer.WriteByte('[')
	for index, item := range items {
		encoded, err := stringifyRaw(item)
		if err != nil {
			return nil, err
		}
		if index > 0 {
			buffer.WriteByte(',')
		}
		buffer.Write(encoded)
	}
	buffer.WriteByte(']')
	return buffer.Bytes(), nil
}
