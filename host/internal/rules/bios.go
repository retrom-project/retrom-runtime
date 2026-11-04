package rules

import (
	"strings"
)

// BIOSMember is one expected firmware archive member.
type BIOSMember struct {
	Name      string  `json:"name"`
	SizeBytes float64 `json:"sizeBytes"`
	CRC32     string  `json:"crc32"`
	SHA1      string  `json:"sha1"`
	Required  bool    `json:"required"`
}

// BIOSRequirement is a runtime firmware requirement; installation IDs never enter a Game configuration.
type BIOSRequirement struct {
	RequirementKey    string            `json:"requirementKey"`
	CoreID            string            `json:"coreId"`
	ProviderID        string            `json:"providerId"`
	TargetID          string            `json:"targetId"`
	LogicalName       string            `json:"logicalName"`
	Required          bool              `json:"required"`
	Condition         string            `json:"condition"`
	SizeBytes         *int64            `json:"sizeBytes"`
	MD5               *string           `json:"md5"`
	SHA256            *string           `json:"sha256"`
	Delivery          string            `json:"delivery"`
	VirtualPath       *string           `json:"virtualPath"`
	ActivationOptions map[string]string `json:"activationOptions"`
	ResourceRole      *string           `json:"resourceRole,omitempty"`
	ArchiveEntries    *[]string         `json:"archiveEntries,omitempty"`
	ArchiveExcludes   *[]string         `json:"archiveExcludes,omitempty"`
	Members           *[]BIOSMember     `json:"members,omitempty"`
	Candidate         *BIOSCandidate    `json:"candidate,omitempty"`
}

// BIOSCandidate describes how a scanned archive matched a requirement.
type BIOSCandidate struct {
	MemberIdentity string `json:"memberIdentity"`
	MatchedMembers int    `json:"matchedMembers"`
	TotalMembers   int    `json:"totalMembers"`
}

// BIOSCatalog projects bios-catalog.json onto product bindings.
func (f *Facts) BIOSCatalog() ([]BIOSRequirement, error) {
	var result []BIOSRequirement
	for index := range f.BIOS {
		item := &f.BIOS[index]
		for bindingIndex := range f.Bindings {
			binding := &f.Bindings[bindingIndex]
			if binding.CoreID != item.CoreID || item.ProviderID != nil && binding.ProviderID != *item.ProviderID ||
				item.TargetID != nil && binding.TargetID != *item.TargetID {
				continue
			}
			requirement, err := biosRequirement(item, binding)
			if err != nil {
				return nil, err
			}
			result = append(result, *requirement)
		}
	}
	return result, nil
}

func biosRequirement(item *BIOSFact, binding *Binding) (*BIOSRequirement, error) {
	key := binding.ProviderID + "/" + binding.TargetID + "/" + item.LogicalName
	if item.RequirementKey != nil {
		key = *item.RequirementKey
	}
	var path *string
	if item.VirtualPath != nil {
		relative, err := publicFirmwarePath(*item.VirtualPath)
		if err != nil {
			return nil, err
		}
		path = &relative
	}
	requirement := &BIOSRequirement{
		RequirementKey: key, CoreID: item.CoreID, ProviderID: binding.ProviderID, TargetID: binding.TargetID,
		LogicalName: item.LogicalName, Required: item.Mode != "OPTIONAL", Condition: item.Condition,
		SizeBytes: item.SizeBytes, MD5: item.MD5, SHA256: item.SHA256, Delivery: item.Delivery, VirtualPath: path,
		ActivationOptions: item.ActivationOptions,
	}
	if item.Members != nil {
		members := item.Members
		requirement.Members = &members
	}
	if item.ResourceRole != nil {
		entries, excludes := item.ArchiveEntries, item.ArchiveExcludes
		requirement.ResourceRole, requirement.ArchiveEntries, requirement.ArchiveExcludes = item.ResourceRole,
			&entries, &excludes
	}
	return requirement, nil
}

// publicFirmwarePath converts a core FS location to the public relative grammar.
func publicFirmwarePath(path string) (string, error) {
	relative := strings.TrimPrefix(path, "/")
	if !canonicalPath(relative) {
		return "", Fail("RUNTIME_DECLARATION_INVALID")
	}
	return relative, nil
}

func canonicalPath(value string) bool {
	if value == "" || UTF16Length(value) > 4096 || strings.Contains(value, `\`) {
		return false
	}
	for _, character := range value {
		if character < 32 || character == 127 {
			return false
		}
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

// FirmwareEvidence is content-derived firmware evidence.
type FirmwareEvidence struct {
	PSXRegion *string `json:"psxRegion"`
}

// BIOSRequest selects requirements for a Target and content.
type BIOSRequest struct {
	ProviderID, TargetID string
	Config               *Configuration
	Files                []File
	Evidence             *FirmwareEvidence
}

var conditionalExtensions = map[string][]string{
	"SEGA_CD_CONTENT": {".chd", ".cue", ".iso"}, "PCE_CD_CONTENT": {".chd", ".cue", ".iso"},
	"AMIGA_CD32_CONTENT":     {".chd", ".iso", ".nrg"},
	"AMIGA_COMPUTER_CONTENT": {".adf", ".adz", ".dms", ".ipf", ".hdf", ".hdz", ".lha", ".zip"},
	"FDS_CONTENT":            {".fds"}, "GB_CONTENT": {".gb", ".dmg"}, "GBC_CONTENT": {".gbc"}, "GBA_CONTENT": {".gba"},
}

// ResolveBIOSRequirements returns the requirements that apply to a Target's content.
func (f *Facts) ResolveBIOSRequirements(request *BIOSRequest) ([]BIOSRequirement, error) {
	name := ""
	if entry, ok := request.Config.Content.Entry(); ok {
		if file := FindFile(request.Files, entry); file != nil {
			name = file.Name
		}
	}
	extension := ""
	if index := strings.LastIndex(name, "."); index >= 0 {
		extension = Lower(name[index:])
	}
	var region *string
	if request.Evidence != nil {
		region = request.Evidence.PSXRegion
	}
	if region != nil && !contains([]string{"JP", "US", "EU"}, *region) {
		return nil, Fail("RUNTIME_EVIDENCE_INVALID")
	}
	catalog, err := f.BIOSCatalog()
	if err != nil {
		return nil, err
	}
	result := []BIOSRequirement{}
	for _, item := range catalog {
		if item.ProviderID != request.ProviderID || item.TargetID != request.TargetID {
			continue
		}
		applies, err := conditionApplies(item.Condition, extension, request.Config, region)
		if err != nil {
			return nil, err
		}
		if !applies {
			continue
		}
		if strings.HasPrefix(item.Condition, "PSX_REGION_") && region == nil {
			item.Required = false
		}
		result = append(result, item)
	}
	return result, nil
}

func conditionApplies(condition, extension string, config *Configuration, region *string) (bool, error) {
	switch condition {
	case "", "SNES_BSX_FIRMWARE", "SNES_SUFAMI_FIRMWARE":
		return true, nil
	case "RPG_RTP":
		return config.Content.Kind == "RPG_MAKER_PROJECT" && config.Content.RTP != nil, nil
	case "GAME_GENIE_ADDON_MODE":
		return coreOption(config, "fceumm", "gameGenie") == true, nil
	case "MGBA_SGB_MODEL":
		return coreOption(config, "mgba", "model") == "SGB", nil
	case "PSX_REGION_JP", "PSX_REGION_US", "PSX_REGION_EU":
		return region == nil || condition == "PSX_REGION_"+*region, nil
	}
	if extensions, exists := conditionalExtensions[condition]; exists {
		return contains(extensions, extension), nil
	}
	return false, Fail("RUNTIME_DECLARATION_INVALID", "condition", condition)
}

func coreOption(config *Configuration, coreID, name string) any {
	core := config.Core(coreID)
	if core == nil || core.Options == nil {
		return nil
	}
	return (*core.Options)[name]
}

// IdentifyBIOSFile matches a scanned file against requirements by digest, or by name when no digest is declared.
func IdentifyBIOSFile(sizeBytes float64, sha256, md5, name string, hasName bool, requirements []BIOSRequirement,
) []BIOSRequirement {
	result := []BIOSRequirement{}
	for _, requirement := range requirements {
		if requirement.SizeBytes != nil && float64(*requirement.SizeBytes) != sizeBytes {
			continue
		}
		matched := false
		switch {
		case requirement.SHA256 != nil:
			matched = *requirement.SHA256 == sha256
		case requirement.MD5 != nil:
			matched = *requirement.MD5 == md5
		default:
			matched = hasName && name == requirement.LogicalName
		}
		if matched {
			result = append(result, requirement)
		}
	}
	return result
}

// ArcadeBIOSRequirements derives firmware ZIP sets from the matching core DAT.
func (f *Facts) ArcadeBIOSRequirements(coreID string, games *ArcadeCatalog, selected []string, filter bool,
) []BIOSRequirement {
	var binding *Binding
	for index := range f.Bindings {
		if f.Bindings[index].CoreID == coreID && f.Bindings[index].HasKind("ARCADE") {
			binding = &f.Bindings[index]
			break
		}
	}
	result := []BIOSRequirement{}
	if binding == nil {
		return result
	}
	for _, name := range games.Names {
		machine := games.Machines[name]
		if !machine.BIOS && (!machine.Device || !hasRequiredROM(machine)) || filter && !contains(selected, name) {
			continue
		}
		path := name + ".zip"
		if coreID == "mame_arcade" {
			path = "content/roms/" + name + ".zip"
		}
		members := make([]BIOSMember, 0, len(machine.ROMs))
		for index := range machine.ROMs {
			rom := &machine.ROMs[index]
			sha1 := ""
			if rom.SHA1 != nil {
				sha1 = *rom.SHA1
			}
			members = append(members, BIOSMember{
				Name: rom.Name, SizeBytes: rom.SizeBytes(), CRC32: rom.CRC, SHA1: sha1,
				Required: !rom.Optional,
			})
		}
		result = append(result, BIOSRequirement{
			RequirementKey: binding.ProviderID + "/" + binding.TargetID + "/" + name + ".zip", CoreID: coreID,
			ProviderID: binding.ProviderID, TargetID: binding.TargetID, LogicalName: name + ".zip", Required: true,
			Condition: "ARCADE_BIOS", Delivery: "EXTERNAL_FILE", VirtualPath: &path, ActivationOptions: map[string]string{},
			Members: &members,
		})
	}
	return result
}
