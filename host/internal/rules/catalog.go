package rules

import (
	"sort"
)

var projectKinds = []string{
	"RPG_MAKER_PROJECT", "SIGLUS_PROJECT", "TYRANOSCRIPT_PROJECT", "NXENGINE_PROJECT",
	"BUTTERSCOTCH_PROJECT", "KIRIKIRI_PROJECT", "ONS_PROJECT", "SCUMMVM_PROJECT",
}

// StorageLayout is the managed storage layout of a binding's content.
func StorageLayout(binding *Binding) string {
	for _, kind := range binding.ContentKinds {
		if contains(projectKinds, kind) {
			return "ZIP_STORE"
		}
	}
	return "FILES"
}

// Target returns a binding's Provider and Target declarations.
func (f *Facts) Target(binding *Binding) (*Provider, *Target) {
	provider := f.Provider(binding.ProviderID)
	if provider == nil {
		return nil, nil
	}
	return provider, provider.Targets[binding.TargetID]
}

// Resolved is one selected implementation for content.
type Resolved struct {
	Binding  *Binding
	Provider *Provider
	Target   *Target
}

// ResolveTarget selects the single binding for a platform, core and content kind.
func (f *Facts) ResolveTarget(platformID, coreID string, content *Content) (*Resolved, error) {
	var matches []*Binding
	for index := range f.Bindings {
		binding := &f.Bindings[index]
		if binding.CoreID == coreID && binding.HasPlatform(platformID) && binding.HasKind(content.Kind) &&
			(binding.Engine == "" || content.Kind == "RPG_MAKER_PROJECT" && binding.Engine == *content.Engine) {
			matches = append(matches, binding)
		}
	}
	if len(matches) != 1 {
		return nil, Fail("RUNTIME_CORE_UNAVAILABLE", "coreId", coreID, "platformId", platformID)
	}
	provider, target := f.Target(matches[0])
	if provider == nil || target == nil {
		return nil, Fail("RUNTIME_DECLARATION_INVALID")
	}
	return &Resolved{Binding: matches[0], Provider: provider, Target: target}, nil
}

// SingleFileBinding reports whether a platform/core accepts single-file content.
func (f *Facts) SingleFileBinding(platformID, coreID string) bool {
	for index := range f.Bindings {
		binding := &f.Bindings[index]
		if binding.CoreID == coreID && binding.HasPlatform(platformID) && binding.HasKind("SINGLE_FILE") {
			return true
		}
	}
	return false
}

// ContentEntryExtensions lists disc or archive entry extensions for a selected single-file target.
func (f *Facts) ContentEntryExtensions(platformID, coreID string) []string {
	if !f.SingleFileBinding(platformID, coreID) {
		return nil
	}
	return f.ContentFormats[coreID]
}

// Catalog projects the runtime catalog for a Provider release version.
func (f *Facts) Catalog(providerVersion string) map[string]any {
	providers := make([]any, 0, len(f.Providers))
	for _, provider := range f.Providers {
		manifest := make(map[string]any, len(provider.Manifest))
		for key, value := range provider.Manifest {
			manifest[key] = value
		}
		if providerVersion != "" {
			manifest["providerVersion"] = providerVersion
		}
		providers = append(providers, manifest)
	}
	bindings := make([]any, 0, len(f.Bindings))
	for index := range f.Bindings {
		bindings = append(bindings, f.catalogBinding(&f.Bindings[index]))
	}
	cores := make([]any, 0, len(f.CoreNames))
	for _, core := range f.CoreNames {
		platforms := []string{}
		for index := range f.Bindings {
			if f.Bindings[index].CoreID == core.ID {
				platforms = appendUnique(platforms, f.Bindings[index].PlatformIDs...)
			}
		}
		sort.Strings(platforms)
		cores = append(cores, map[string]any{"id": core.ID, "displayName": core.DisplayName, "platformIds": platforms})
	}
	return map[string]any{"providers": providers, "bindings": bindings, "platforms": f.Platforms, "cores": cores}
}

func (f *Facts) catalogBinding(binding *Binding) map[string]any {
	result := map[string]any{
		"coreId": binding.CoreID, "providerId": binding.ProviderID, "targetId": binding.TargetID,
		"platformIds": binding.PlatformIDs, "contentKinds": binding.ContentKinds, "storageLayout": StorageLayout(binding),
	}
	if binding.Engine != "" {
		result["engine"] = binding.Engine
	}
	if binding.HasKind("SINGLE_FILE") {
		extensions := []string{}
		for _, extension := range f.ContentFormats[binding.CoreID] {
			if extension == "zip" || extension == "7z" {
				extensions = append(extensions, extension)
			}
		}
		if len(extensions) > 0 {
			result["archiveExtensions"] = extensions
		}
	}
	if binding.HasKind("ARCADE") {
		extensions := []string{"zip"}
		if binding.CoreID == "mame_arcade" {
			extensions = []string{"zip", "chd"}
		}
		result["dependencyFiles"] = map[string]any{"extensions": extensions}
	}
	_, target := f.Target(binding)
	if target != nil && target.ROMSetSelection != nil {
		result["romSetSelection"] = map[string]any{"datSHA256": target.ROMSetSelection.DatSHA256}
	}
	if target != nil && target.ContentRequirements != nil && target.ContentRequirements.Kind == "FLYCAST_CARTRIDGE" {
		result["archiveExtensions"] = []string{"zip"}
		result["dependencyFiles"] = map[string]any{"extensions": []string{"zip", "chd"}}
	}
	return result
}

func appendUnique(values []string, items ...string) []string {
	for _, item := range items {
		if !contains(values, item) {
			values = append(values, item)
		}
	}
	return values
}

func sortStrings(values []string) { sort.Strings(values) }

func sortUTF8(values []string) {
	sort.SliceStable(values, func(i, j int) bool { return UTF8Compare(values[i], values[j]) < 0 })
}
