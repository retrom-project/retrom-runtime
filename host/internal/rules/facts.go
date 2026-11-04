package rules

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	retromruntime "github.com/retrom-project/retrom-runtime"
)

// Binding is one product route from a platform/core pair to a Provider Target.
type Binding struct {
	CoreID       string   `json:"coreId"`
	ProviderID   string   `json:"providerId"`
	TargetID     string   `json:"targetId"`
	PlatformIDs  []string `json:"platformIds"`
	ContentKinds []string `json:"contentKinds"`
	Engine       string   `json:"engine,omitempty"`
}

// HasPlatform reports whether the binding serves platform.
func (b *Binding) HasPlatform(platform string) bool { return contains(b.PlatformIDs, platform) }

// HasKind reports whether the binding accepts a content kind.
func (b *Binding) HasKind(kind string) bool { return contains(b.ContentKinds, kind) }

// NamedID is an identifier with a display name.
type NamedID struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

// AssetReference is an exact Provider asset.
type AssetReference struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

// ContentRequirements are Target-declared content facts.
type ContentRequirements struct {
	Kind     string          `json:"kind"`
	Platform string          `json:"platform,omitempty"`
	Catalog  *AssetReference `json:"catalog,omitempty"`
	Core     *AssetReference `json:"core,omitempty"`
}

// ROMSetSelection is the offline DAT selection capability of a Target.
type ROMSetSelection struct {
	DatSHA256 string `json:"datSHA256"`
	Driver    string `json:"driver"`
}

// Input is a Target input declaration.
type Input struct {
	Role string `json:"role"`
	Kind string `json:"kind"`
}

// Checkpoint is the projected checkpoint contract.
type Checkpoint struct {
	MaxBytes    int64    `json:"maxBytes"`
	ReadFormats []string `json:"readFormats"`
	WriteFormat string   `json:"writeFormat"`
	Semantics   string   `json:"semantics"`
}

// Target combines a projected manifest Target with host-only declaration fields.
type Target struct {
	ID                  string               `json:"id"`
	AssetPaths          []string             `json:"assetPaths"`
	Inputs              []Input              `json:"inputs"`
	Checkpoint          *Checkpoint          `json:"checkpoint"`
	ContentRequirements *ContentRequirements `json:"contentRequirements"`
	OptionsSchema       map[string]any       `json:"targetOptionsSchema"`
	Capabilities        json.RawMessage      `json:"capabilities"`
	AdapterID           string               `json:"-"`
	ROMSetSelection     *ROMSetSelection     `json:"-"`
}

// Provider is one projected Provider declaration.
type Provider struct {
	ID       string
	Manifest map[string]any
	Targets  map[string]*Target
}

type declarationDocument struct {
	SchemaVersion int `json:"schemaVersion"`
	Providers     []struct {
		Manifest json.RawMessage `json:"manifest"`
		Targets  map[string]struct {
			AdapterID       string           `json:"adapterId"`
			ROMSetSelection *ROMSetSelection `json:"romSetSelection"`
		} `json:"targets"`
	} `json:"providers"`
}

// BIOSFact is one bios-catalog.json record.
type BIOSFact struct {
	CoreID            string            `json:"coreId"`
	LogicalName       string            `json:"logicalName"`
	Mode              string            `json:"mode"`
	Condition         string            `json:"condition"`
	SizeBytes         *int64            `json:"sizeBytes"`
	MD5               *string           `json:"md5"`
	SHA256            *string           `json:"sha256"`
	ActivationOptions map[string]string `json:"activationOptions"`
	Delivery          string            `json:"delivery"`
	VirtualPath       *string           `json:"virtualPath"`
	RequirementKey    *string           `json:"requirementKey"`
	ProviderID        *string           `json:"providerID"`
	TargetID          *string           `json:"targetID"`
	Members           []BIOSMember      `json:"members"`
	ResourceRole      *string           `json:"resourceRole"`
	ArchiveEntries    []string          `json:"archiveEntries"`
	ArchiveExcludes   []string          `json:"archiveExcludes"`
}

// Facts are the immutable embedded runtime facts.
type Facts struct {
	Bindings       []Binding
	Platforms      []NamedID
	CoreNames      []NamedID
	ContentFormats map[string][]string
	BIOS           []BIOSFact
	Provenance     []map[string]any
	Providers      []*Provider
	arcadeOnce     sync.Once
	arcade         map[string]*ArcadeCatalog
	arcadeCores    []string
	arcadeErr      error
}

var (
	factsOnce sync.Once
	loaded    *Facts
	loadErr   error
)

// Load parses the embedded runtime facts once.
func Load() (*Facts, error) {
	factsOnce.Do(func() { loaded, loadErr = parseFacts() })
	return loaded, loadErr
}

func readFact(name string, target any) error {
	data, err := retromruntime.Facts.ReadFile(name)
	if err != nil {
		return fmt.Errorf("runtime facts %s: %w", name, err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("runtime facts %s: %w", name, err)
	}
	return nil
}

func parseFacts() (*Facts, error) {
	facts := &Facts{}
	var formats struct {
		Cores map[string]struct {
			Extensions []string `json:"extensions"`
		} `json:"cores"`
	}
	for name, target := range map[string]any{
		"src/runtime/bindings.json": &facts.Bindings, "src/runtime/platforms.json": &facts.Platforms,
		"src/runtime/core-names.json": &facts.CoreNames, "src/runtime/content-formats.json": &formats,
		"src/runtime/bios-catalog.json": &facts.BIOS, "src/runtime/arcade-provenance.json": &facts.Provenance,
	} {
		if err := readFact(name, target); err != nil {
			return nil, err
		}
	}
	facts.ContentFormats = make(map[string][]string, len(formats.Cores))
	for core, format := range formats.Cores {
		facts.ContentFormats[core] = format.Extensions
	}
	var document declarationDocument
	if err := readFact("host/facts/declarations.json", &document); err != nil {
		return nil, err
	}
	if document.SchemaVersion != 1 {
		return nil, Fail("RUNTIME_DECLARATION_INVALID")
	}
	for _, record := range document.Providers {
		provider, err := parseProvider(record.Manifest)
		if err != nil {
			return nil, err
		}
		for id, extra := range record.Targets {
			target := provider.Targets[id]
			if target == nil {
				return nil, Fail("RUNTIME_DECLARATION_INVALID")
			}
			target.AdapterID, target.ROMSetSelection = extra.AdapterID, extra.ROMSetSelection
		}
		facts.Providers = append(facts.Providers, provider)
	}
	return facts, nil
}

func parseProvider(raw json.RawMessage) (*Provider, error) {
	var manifest map[string]any
	var typed struct {
		ProviderID string    `json:"providerId"`
		Targets    []*Target `json:"targets"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, fmt.Errorf("runtime declarations: %w", err)
	}
	if err := json.Unmarshal(raw, &typed); err != nil {
		return nil, fmt.Errorf("runtime declarations: %w", err)
	}
	provider := &Provider{ID: typed.ProviderID, Manifest: manifest, Targets: make(map[string]*Target)}
	for _, target := range typed.Targets {
		provider.Targets[target.ID] = target
	}
	return provider, nil
}

// ArcadeCatalogs returns the paired DAT tables, parsed on first use.
func (f *Facts) ArcadeCatalogs() (map[string]*ArcadeCatalog, error) {
	f.arcadeOnce.Do(func() {
		data, err := retromruntime.Facts.ReadFile("assets/facts/arcade-catalog.json.gz")
		if err != nil {
			f.arcadeErr = fmt.Errorf("arcade catalog: %w", err)
			return
		}
		reader, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			f.arcadeErr = fmt.Errorf("arcade catalog: %w", err)
			return
		}
		decoded, err := io.ReadAll(reader)
		if err != nil {
			f.arcadeErr = fmt.Errorf("arcade catalog: %w", err)
			return
		}
		f.arcadeErr = f.parseArcade(decoded)
	})
	return f.arcade, f.arcadeErr
}

// ArcadeCores lists the cores with a paired DAT in source order.
func (f *Facts) ArcadeCores() ([]string, error) {
	if _, err := f.ArcadeCatalogs(); err != nil {
		return nil, err
	}
	return f.arcadeCores, nil
}

func (f *Facts) parseArcade(data []byte) error {
	cores, values, err := ObjectKeys(data)
	if err != nil {
		return err
	}
	f.arcade = make(map[string]*ArcadeCatalog, len(cores))
	for _, core := range cores {
		var catalog ArcadeCatalog
		if err := json.Unmarshal(values[core], &catalog); err != nil {
			return fmt.Errorf("arcade catalog %s: %w", core, err)
		}
		f.arcade[core] = &catalog
	}
	f.arcadeCores = cores
	return nil
}

// Provider returns the named Provider declaration.
func (f *Facts) Provider(id string) *Provider {
	for _, provider := range f.Providers {
		if provider.ID == id {
			return provider
		}
	}
	return nil
}
