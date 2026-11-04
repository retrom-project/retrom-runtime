// Package pipeline defines the host content-normalization plugin contract.
package pipeline

import (
	"context"
	"fmt"
	"sync"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

// Sources are effective file facts with their bounded locators.
type Sources struct {
	Files    []rules.File
	Locators map[string]content.Locator
}

// Locator returns the validated locator of a file.
func (s *Sources) Locator(file *rules.File) (*content.Locator, error) {
	locator, err := content.Require(s.Locators, file)
	if err != nil {
		return nil, fmt.Errorf("content locator: %w", err)
	}
	return locator, nil
}

// Context is one phase's read-only view of a whole game.
type Context struct {
	Ctx context.Context
	Sources
	PlatformID        string
	Original          Sources
	SourceContentHash string
	Cache             *Cache
	OutputRoot        string
	AuditRoot         string
}

// Cache shares bounded inspection results within one phase.
type Cache struct {
	mutex  sync.Mutex
	values map[string]any
}

// NewCache returns an empty phase cache.
func NewCache() *Cache { return &Cache{values: map[string]any{}} }

// Load returns a cached value or computes and stores it.
func (c *Cache) Load(key string, compute func() (any, error)) (any, error) {
	c.mutex.Lock()
	value, exists := c.values[key]
	c.mutex.Unlock()
	if exists {
		return value, nil
	}
	value, err := compute()
	if err != nil {
		return nil, err
	}
	c.mutex.Lock()
	c.values[key] = value
	c.mutex.Unlock()
	return value, nil
}

// Plan is one claimed conversion.
type Plan struct {
	Format       string
	Claims       []string
	Outputs      []string
	Overrides    []string
	LaunchDomain *string
	Data         any
}

// OutputFile is a converted file below the phase output root.
type OutputFile struct {
	rules.File
	Path string `json:"path"`
}

// Warning is an aggregated warning count.
type Warning struct {
	Code  string `json:"code"`
	Count int    `json:"count"`
}

// Summary is a plugin conversion summary.
type Summary struct {
	ArchiveCount           *int             `json:"archiveCount,omitempty"`
	VerifiedEntries        int              `json:"verifiedEntries"`
	MetadataCorrections    int              `json:"metadataCorrections"`
	OmittedPhysicalEntries int              `json:"omittedPhysicalEntries"`
	Warnings               []Warning        `json:"warnings"`
	Details                []map[string]any `json:"details"`
}

// Result is a plugin conversion result.
type Result struct {
	Files   []OutputFile
	Summary *Summary
}

// Plugin is one explicit host-only normalizer registration.
type Plugin struct {
	ID        string
	Phase     string
	Version   int
	Priority  int
	Platforms []string
	Formats   []string
	Probe     func(*Context) ([]*Plan, error)
	Convert   func(*Context, *Plan) (*Result, error)
}
