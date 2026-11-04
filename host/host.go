// Package host implements the retrom-runtime host operations used by a server: catalog projection, content
// identity, launch preparation, review evidence and content normalization. It runs in the caller's process.
package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

// Error is a stable runtime reason code. Details are safe, non-authoritative context.
type Error struct {
	Code    string
	Details map[string]string
}

func (e *Error) Error() string { return e.Code }

// Service executes host commands. It is safe for concurrent use.
type Service struct {
	facts           *rules.Facts
	providerVersion string
}

// New loads the embedded runtime facts. providerVersion labels the projected Provider declarations
// with the installed Provider release; it does not change any runtime decision.
func New(providerVersion string) (*Service, error) {
	facts, err := rules.Load()
	if err != nil {
		return nil, fmt.Errorf("runtime facts: %w", err)
	}
	return &Service{facts: facts, providerVersion: providerVersion}, nil
}

type handler func(*Service, context.Context, json.RawMessage) (any, error)

var commands = map[string]handler{
	"storage-layout":                  (*Service).storageLayout,
	"catalog":                         (*Service).catalog,
	"detect-scummvm":                  (*Service).detectScummvm,
	"normalize-content":               (*Service).normalizeContent,
	"discover-content":                (*Service).discoverContent,
	"dos-entry-candidates":            (*Service).dosEntryCandidates,
	"rpg-entry-candidates":            (*Service).rpgEntryCandidates,
	"kirikiri-entry-candidates":       (*Service).kirikiriEntryCandidates,
	"launch-options":                  (*Service).launchOptionsCommand,
	"arcade-parents":                  (*Service).arcadeParents,
	"rom-sets":                        (*Service).romSets,
	"reconcile-config":                (*Service).reconcileConfig,
	"prepare":                         (*Service).prepare,
	"batch-identity":                  (*Service).batchIdentity,
	"batch-restorable":                (*Service).batchRestorable,
	"batch-content-bios-requirements": (*Service).batchContentBIOS,
	"bios-identify":                   (*Service).biosIdentify,
	"bios-verify":                     (*Service).biosVerify,
	"bios-requirements":               (*Service).biosRequirements,
	"configure":                       (*Service).configure,
	"restorable":                      (*Service).restorable,
}

// Deadline is the maximum execution time of a command.
func Deadline(command string) time.Duration {
	switch command {
	case "normalize-content":
		return time.Hour
	case "detect-scummvm":
		return time.Minute
	default:
		return 30 * time.Second
	}
}

// Call executes command with a JSON object input and returns its JSON result.
func (s *Service) Call(ctx context.Context, command string, input []byte) (json.RawMessage, error) {
	run, exists := commands[command]
	if !exists {
		return nil, &Error{Code: "RUNTIME_COMMAND_INVALID"}
	}
	trimmed := bytes.TrimSpace(input)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, &Error{Code: "RUNTIME_REQUEST_INVALID"}
	}
	ctx, cancel := context.WithTimeout(ctx, Deadline(command))
	defer cancel()
	result, err := execute(ctx, run, s, trimmed)
	if ctx.Err() != nil {
		return nil, &Error{Code: "RUNTIME_CANCELLED"}
	}
	if err != nil {
		return nil, publicError(err)
	}
	encoded, err := marshal(result)
	if err != nil {
		return nil, &Error{Code: "RUNTIME_RESPONSE_INVALID"}
	}
	return encoded, nil
}

// errDefect reports a recovered panic: a host defect must fail one request, never the embedding process.
var errDefect = errors.New("runtime host defect")

func execute(ctx context.Context, run handler, s *Service, input json.RawMessage) (any, error) {
	var result any
	var err error
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				result, err = nil, errDefect
			}
		}()
		result, err = run(s, ctx, input)
	}()
	return result, err
}

func publicError(err error) *Error {
	var failure *rules.Failure
	if errors.As(err, &failure) {
		result := &Error{Code: failure.Code}
		if failure.Code == "RUNTIME_PARENT_MISSING" {
			result.Details = failure.Details
		}
		return result
	}
	var syntax *json.SyntaxError
	var mismatch *json.UnmarshalTypeError
	if errors.As(err, &syntax) || errors.As(err, &mismatch) {
		return &Error{Code: "RUNTIME_REQUEST_INVALID"}
	}
	return &Error{Code: "RUNTIME_REQUEST_FAILED"}
}

func marshal(value any) (json.RawMessage, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, fmt.Errorf("runtime result: %w", err)
	}
	return json.RawMessage(strings.TrimSuffix(buffer.String(), "\n")), nil
}

func decode(input json.RawMessage, target any) error {
	if err := json.Unmarshal(input, target); err != nil {
		return fmt.Errorf("runtime input: %w", err)
	}
	return nil
}

func (s *Service) storageLayout(_ context.Context, input json.RawMessage) (any, error) {
	var value struct {
		PlatformID string `json:"platformId"`
		CoreID     string `json:"coreId"`
		Config     any    `json:"config"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	config, err := rules.ParseConfiguration(value.Config)
	if err != nil {
		return nil, fmt.Errorf("parse configuration: %w", err)
	}
	resolved, err := s.facts.ResolveTarget(value.PlatformID, value.CoreID, &config.Content)
	if err != nil {
		return nil, fmt.Errorf("resolve target: %w", err)
	}
	return map[string]string{"layout": rules.StorageLayout(resolved.Binding)}, nil
}

func (s *Service) catalog(context.Context, json.RawMessage) (any, error) {
	catalog := s.facts.Catalog(s.providerVersion)
	requirements, err := s.facts.BIOSCatalog()
	if err != nil {
		return nil, fmt.Errorf("bios catalog: %w", err)
	}
	tables, err := s.facts.ArcadeCatalogs()
	if err != nil {
		return nil, fmt.Errorf("arcade catalog: %w", err)
	}
	cores, err := s.facts.ArcadeCores()
	if err != nil {
		return nil, fmt.Errorf("arcade catalog: %w", err)
	}
	for _, core := range cores {
		requirements = append(requirements, s.facts.ArcadeBIOSRequirements(core, tables[core], nil, false)...)
	}
	catalog["biosRequirements"] = requirements
	return catalog, nil
}

func (s *Service) prepare(ctx context.Context, input json.RawMessage) (any, error) {
	var value request
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	prepared, err := s.prepareInput(ctx, &value)
	if err != nil {
		return nil, err
	}
	result, err := s.facts.Prepare(prepared)
	if err != nil {
		return nil, fmt.Errorf("prepare: %w", err)
	}
	return result, nil
}

func (s *Service) batchIdentity(_ context.Context, input json.RawMessage) (any, error) {
	var value struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	if value.Items == nil || len(value.Items) > 10000 {
		return nil, rules.Fail("RUNTIME_REQUEST_TOO_LARGE")
	}
	results := make([]any, 0, len(value.Items))
	for _, raw := range value.Items {
		var item rules.PrepareRequest
		if err := decode(raw, &item); err != nil {
			results = append(results, map[string]string{"error": "RUNTIME_REQUEST_INVALID"})
			continue
		}
		identity, err := s.facts.InspectIdentity(&item)
		if err != nil {
			results = append(results, map[string]string{"error": publicError(err).Code})
			continue
		}
		results = append(results, identity)
	}
	return results, nil
}

func (s *Service) batchRestorable(_ context.Context, input json.RawMessage) (any, error) {
	var value struct {
		Items []rules.RestoreInput `json:"items"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	if value.Items == nil || len(value.Items) > 10000 {
		return nil, rules.Fail("RUNTIME_REQUEST_TOO_LARGE")
	}
	results := make([]rules.Restorability, 0, len(value.Items))
	for index := range value.Items {
		results = append(results, rules.Restore(&value.Items[index]))
	}
	return results, nil
}
