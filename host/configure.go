package host

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"unicode/utf8"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

type configureInput struct {
	rules.ConfigureRequest
	Locators      map[string]content.Locator `json:"locators"`
	ProviderRoots map[string]string          `json:"providerRoots"`
}

func (s *Service) configure(ctx context.Context, input json.RawMessage) (any, error) {
	var value configureInput
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	if err := s.configureEvidence(ctx, &value); err != nil {
		return nil, err
	}
	result, err := s.facts.Configure(&value.ConfigureRequest)
	if err != nil {
		return nil, fmt.Errorf("configure: %w", err)
	}
	return result, nil
}

var dosConfigureArchive = regexp.MustCompile(`\.(?:zip|dosz)$`)

// configureEvidence reads the bounded evidence configuration rules need from exact immutable files.
// configureCatalogs loads the arcade DATs and the Flycast tables the configuration rules may consult.
func (s *Service) configureCatalogs(input *configureInput) error {
	if input.PlatformID == "arcade" {
		tables, err := s.facts.ArcadeCatalogs()
		if err != nil {
			return fmt.Errorf("arcade catalog: %w", err)
		}
		input.ArcadeCatalogs = tables
	}
	tables, err := s.flycastCatalogs(input.PlatformID, input.CoreIDs, input.ProviderRoots)
	if err != nil {
		return err
	}
	input.FlycastTables, input.FlycastKnown = tables, len(tables) > 0
	return nil
}

func (s *Service) configureEvidence(ctx context.Context, input *configureInput) error {
	if _, err := rules.ContentHash(input.Files, "TREE"); err != nil {
		return fmt.Errorf("content hash: %w", err)
	}
	if input.Evidence == nil {
		input.Evidence = map[string]rules.ConfigureEvidence{}
	}
	if input.ArchiveMembers == nil {
		input.ArchiveMembers = map[string][]string{}
	}
	if input.PlatformID == "kirikiri" {
		if err := s.configurePrefixes(ctx, input); err != nil {
			return err
		}
	}
	samples := 0
	for index := range input.Files {
		if err := s.fileEvidence(ctx, input, &input.Files[index], &samples); err != nil {
			return err
		}
	}
	if input.PlatformID == "scummvm" && (input.Selection == nil || input.Selection.ScummVM == nil) {
		options, err := s.configureScummvm(ctx, input)
		if err != nil {
			return err
		}
		if input.Selection == nil {
			input.Selection = &rules.Selection{}
		}
		input.Selection.ScummVM = options
	}
	if err := s.configureCatalogs(input); err != nil {
		return err
	}
	if input.PlatformID == "kirikiri" {
		return s.configurePatches(ctx, input)
	}
	return nil
}

func (s *Service) configurePrefixes(ctx context.Context, input *configureInput) error {
	located := &request{Locators: input.Locators}
	evidence := map[string]rules.Evidence{}
	for key, record := range input.Evidence {
		evidence[key] = rules.Evidence{PrefixBase64: record.PrefixBase64, Text: record.Text}
	}
	prefixes, err := s.kirikiriPrefixes(ctx, located, input.Files, evidence)
	if err != nil {
		return err
	}
	for key, record := range prefixes {
		current := input.Evidence[key]
		current.PrefixBase64 = record.PrefixBase64
		input.Evidence[key] = current
	}
	return nil
}

func (s *Service) configurePatches(ctx context.Context, input *configureInput) error {
	located := &request{Locators: input.Locators}
	located.Files = input.Files
	evidence := map[string]rules.Evidence{}
	for key, record := range input.Evidence {
		evidence[key] = rules.Evidence{PrefixBase64: record.PrefixBase64, Text: record.Text}
	}
	patched, err := s.patchEvidence(ctx, located, evidence)
	if err != nil {
		return err
	}
	for key, record := range patched {
		current := input.Evidence[key]
		current.Text = record.Text
		input.Evidence[key] = current
	}
	return nil
}

func (s *Service) fileEvidence(ctx context.Context, input *configureInput, file *rules.File, samples *int) error {
	name := rules.Lower(rules.BaseName(file.LogicalKey))
	_, located := input.Locators[file.LogicalKey]
	record, known := input.Evidence[file.LogicalKey]
	if !located {
		return nil
	}
	switch {
	case input.PlatformID == "rpgmaker" && (name == "game.ini" || name == "rpg_rt.ldb") && !known:
		return rpgEvidence(ctx, input, file, name)
	case input.PlatformID == "ons" && containsString(rules.ONSScriptNames, rules.BaseName(file.LogicalKey)) && !known:
		*samples++
		if *samples > 64 {
			return rules.Fail("RUNTIME_EVIDENCE_TOO_LARGE")
		}
		return onsEvidence(ctx, input, file, record)
	case input.PlatformID == "dos" && dosConfigureArchive.MatchString(name):
		if _, done := input.ArchiveMembers[file.LogicalKey]; done {
			return nil
		}
		return dosEvidence(input, file)
	}
	return nil
}

// onsEvidence samples the bounded prefix of an ONScripter script for encoding detection.
func onsEvidence(ctx context.Context, input *configureInput, file *rules.File, record rules.ConfigureEvidence) error {
	locator, err := content.Require(input.Locators, file)
	if err != nil {
		return fmt.Errorf("require: %w", err)
	}
	prefix, err := content.ReadPrefix(ctx, locator, int64(min(file.SizeBytes, rules.ONSSampleBytes)))
	if err != nil {
		return fmt.Errorf("read prefix: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(prefix)
	record.PrefixBase64 = &encoded
	input.Evidence[file.LogicalKey] = record
	return nil
}

// dosEvidence lists the member names of a DOS archive.
func dosEvidence(input *configureInput, file *rules.File) error {
	locator, err := content.Require(input.Locators, file)
	if err != nil {
		return fmt.Errorf("require: %w", err)
	}
	members, err := content.Members(locator, content.MemberOptions{})
	if err != nil {
		return fmt.Errorf("members: %w", err)
	}
	input.ArchiveMembers[file.LogicalKey] = memberNames(members)
	return nil
}

func rpgEvidence(ctx context.Context, input *configureInput, file *rules.File, name string) error {
	maximum := 24.0 * 1024 * 1024
	if name == "game.ini" {
		maximum = 262144
	}
	if file.SizeBytes > maximum {
		return rules.Fail("RUNTIME_EVIDENCE_TOO_LARGE")
	}
	locator, err := content.Require(input.Locators, file)
	if err != nil {
		return fmt.Errorf("require: %w", err)
	}
	data, err := content.ReadAll(ctx, locator)
	if err != nil {
		return fmt.Errorf("read all: %w", err)
	}
	if float64(len(data)) != file.SizeBytes || content.SHA256(data) != file.SHA256 {
		return rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	var record rules.ConfigureEvidence
	if name == "game.ini" {
		// TextDecoder replaces invalid UTF-8 and strips a BOM.
		text := []rune{}
		for len(data) > 0 {
			character, size := utf8.DecodeRune(data)
			text = append(text, character)
			data = data[size:]
		}
		decoded := string(text)
		if len(decoded) >= 3 && decoded[:3] == "\xef\xbb\xbf" {
			decoded = decoded[3:]
		}
		record.Text = &decoded
	} else {
		encoded := base64.StdEncoding.EncodeToString(data)
		record.BytesBase64 = &encoded
	}
	input.Evidence[file.LogicalKey] = record
	return nil
}

// configureScummvm copies the verified tree to a private directory and accepts only an automatic selection.
func (s *Service) configureScummvm(ctx context.Context, input *configureInput) (map[string]any, error) {
	var providerRoot string
	for index := range s.facts.Bindings {
		binding := &s.facts.Bindings[index]
		if binding.HasPlatform(input.PlatformID) && containsString(input.CoreIDs, binding.CoreID) {
			providerRoot = input.ProviderRoots[binding.ProviderID]
			break
		}
	}
	if len(providerRoot) == 0 || providerRoot[0] != '/' {
		return nil, rules.Fail("RUNTIME_DETECTOR_UNAVAILABLE")
	}
	treeRoot, err := os.MkdirTemp("", "retrom-runtime-configure-")
	if err != nil {
		return nil, fmt.Errorf("scummvm tree: %w", err)
	}
	defer func() { _ = os.RemoveAll(treeRoot) }()
	for index := range input.Files {
		if err := copyVerified(ctx, input, &input.Files[index], treeRoot); err != nil {
			return nil, err
		}
	}
	result, err := detect(ctx, providerRoot, treeRoot)
	if err != nil {
		return nil, err
	}
	detected, _ := result.(map[string]any)
	candidates, _ := detected["candidates"].([]map[string]any)
	for _, candidate := range candidates {
		if candidate["id"] == detected["automaticSelection"] && candidate["blocker"] == nil {
			raw, isRaw := candidate["options"].(json.RawMessage)
			if !isRaw {
				return nil, rules.Fail("RUNTIME_DETECTION_RESULT_INVALID")
			}
			var options map[string]any
			if err := json.Unmarshal(raw, &options); err != nil {
				return nil, fmt.Errorf("scummvm options: %w", err)
			}
			return options, nil
		}
	}
	return nil, rules.Fail("RUNTIME_SCUMMVM_SELECTION_REQUIRED")
}

func copyVerified(ctx context.Context, input *configureInput, file *rules.File, root string) error {
	if !rules.SafePath(file.LogicalKey) {
		return rules.Fail("RUNTIME_DETECTION_INPUT_INVALID")
	}
	locator, err := content.Require(input.Locators, file)
	if err != nil {
		return fmt.Errorf("require: %w", err)
	}
	destination := filepath.Join(root, file.LogicalKey)
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return fmt.Errorf("scummvm tree: %w", err)
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("scummvm tree: %w", err)
	}
	hash := sha256.New()
	err = content.Stream(ctx, locator, 0, int64(locator.SizeBytes), &teeWriter{output, hash})
	if closeErr := output.Close(); err == nil && closeErr != nil {
		err = fmt.Errorf("scummvm tree: %w", closeErr)
	}
	if err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != file.SHA256 {
		return rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	return nil
}

type teeWriter struct {
	file *os.File
	hash interface{ Write([]byte) (int, error) }
}

func (w *teeWriter) Write(data []byte) (int, error) {
	if _, err := w.hash.Write(data); err != nil {
		return 0, fmt.Errorf("hash: %w", err)
	}
	written, err := w.file.Write(data)
	if err != nil {
		return written, fmt.Errorf("write: %w", err)
	}
	return written, nil
}

func (s *Service) biosRequirements(_ context.Context, input json.RawMessage) (any, error) {
	var value struct {
		ProviderID string                  `json:"providerId"`
		TargetID   string                  `json:"targetId"`
		Config     any                     `json:"config"`
		Files      []rules.File            `json:"files"`
		Evidence   *rules.FirmwareEvidence `json:"firmwareEvidence"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	config, err := rules.ParseConfiguration(value.Config)
	if err != nil {
		return nil, fmt.Errorf("parse configuration: %w", err)
	}
	result, err := s.facts.ResolveBIOSRequirements(&rules.BIOSRequest{
		ProviderID: value.ProviderID, TargetID: value.TargetID,
		Config: config, Files: value.Files, Evidence: value.Evidence,
	})
	if err != nil {
		return nil, fmt.Errorf("bios requirements: %w", err)
	}
	return result, nil
}

func (s *Service) restorable(_ context.Context, input json.RawMessage) (any, error) {
	var value rules.RestoreInput
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	return rules.Restore(&value), nil
}
