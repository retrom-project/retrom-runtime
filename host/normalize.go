package host

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/normalize"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

// normalizeContent converts supported protected containers and resources into standard files below outputRoot.
func (s *Service) normalizeContent(ctx context.Context, input json.RawMessage) (any, error) {
	var value struct {
		PlatformID string                     `json:"platformId"`
		Files      []rules.File               `json:"files"`
		Locators   map[string]content.Locator `json:"locators"`
		OutputRoot string                     `json:"outputRoot"`
	}
	if err := decode(input, &value); err != nil {
		return nil, err
	}
	result, err := normalize.Normalize(ctx, value.PlatformID, value.Files, value.Locators, value.OutputRoot)
	if err != nil {
		return nil, fmt.Errorf("normalize content: %w", err)
	}
	return result, nil
}
