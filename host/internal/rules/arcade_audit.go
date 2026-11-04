package rules

// CRCWarning reports a member whose size/name matched but CRC differs.
type CRCWarning struct {
	Role          string `json:"role"`
	File          string `json:"file"`
	Member        string `json:"member"`
	ExpectedCRC32 string `json:"expectedCRC32"`
	ActualCRC32   string `json:"actualCRC32"`
}

// MissingROMMember is one missing or mis-sized required ROM.
type MissingROMMember struct {
	CoreID    string  `json:"coreId"`
	ROMSet    string  `json:"romSet"`
	Role      string  `json:"role"`
	Member    string  `json:"member"`
	SizeBytes float64 `json:"sizeBytes"`
	Reason    string  `json:"reason"`
}

// ArcadeCRCWarnings audits CRC mismatches of the selected machine, its parents and devices.
func ArcadeCRCWarnings(coreID string, config *Configuration, files []File, archives map[string][]ArchiveMember,
	catalog *ArcadeCatalog,
) ([]CRCWarning, error) {
	warnings := []CRCWarning{}
	if config.Content.Kind != "ARCADE" {
		return warnings, nil
	}
	entry := FindFile(files, *config.Content.EntryFile)
	if entry == nil {
		return warnings, nil
	}
	machineID := ConfiguredMachine(coreID, config, entry.Name)
	if catalog.Machine(machineID) == nil {
		return warnings, nil
	}
	tree, err := arcadeAncestry(machineID, catalog)
	if err != nil {
		return nil, err
	}
	var available []ArchiveMember
	for _, key := range append([]string{entry.LogicalKey}, config.Core(coreID).Parents()...) {
		for _, member := range archives[key] {
			member.File = key
			available = append(available, member)
		}
	}
	for _, owner := range append(append([]ancestor(nil), tree.Parents...), tree.Devices...) {
		for index := range owner.Machine.ROMs {
			rom := &owner.Machine.ROMs[index]
			member := ROMMember(available, rom)
			if member == nil || Lower(member.CRC32) == Lower(rom.CRC) {
				continue
			}
			role := "PARENT"
			if firmwareMatches(tree.Firmware, rom) {
				role = "BIOS"
			} else if member.File == entry.LogicalKey {
				role = "ROM"
			}
			warning := CRCWarning{
				Role: role, File: member.File, Member: member.Name,
				ExpectedCRC32: Lower(rom.CRC), ActualCRC32: Lower(member.CRC32),
			}
			if !hasWarning(warnings, &warning) {
				warnings = append(warnings, warning)
			}
		}
	}
	return warnings, nil
}

// firmwareMatches uses the exact size/CRC comparison of the CRC audit.
func firmwareMatches(firmware []*ArcadeROM, rom *ArcadeROM) bool {
	for _, other := range firmware {
		if other.Size == rom.Size && other.CRC == rom.CRC && (other.Name == rom.Name || rom.Merge != "" &&
			other.Name == rom.Merge) {
			return true
		}
	}
	return false
}

func hasWarning(warnings []CRCWarning, warning *CRCWarning) bool {
	for _, other := range warnings {
		if other.File == warning.File && other.Member == warning.Member && other.ExpectedCRC32 == warning.ExpectedCRC32 {
			return true
		}
	}
	return false
}

// auditedMembers are the entry members plus those of selected non-BIOS parent archives.
func auditedMembers(tree *ancestry, selected []string, files []File, entry *File,
	archives map[string][]ArchiveMember,
) []ArchiveMember {
	parentIDs := map[string]bool{}
	for _, parent := range tree.Parents[1:] {
		if !parent.Machine.BIOS {
			parentIDs[parent.ID] = true
		}
	}
	members := append([]ArchiveMember(nil), archives[entry.LogicalKey]...)
	for index := range files {
		if contains(selected, files[index].LogicalKey) && parentIDs[ArchiveID(files[index].Name)] {
			members = append(members, archives[files[index].LogicalKey]...)
		}
	}
	return members
}

func inheritedFromParent(tree *ancestry, rom *ArcadeROM) bool {
	for _, parent := range tree.Parents[1:] {
		if !parent.Machine.BIOS && machineHasROM(parent.Machine, rom) {
			return true
		}
	}
	return false
}

// ArcadeMissingROMMembers audits only the selected game's required payload.
func ArcadeMissingROMMembers(coreID string, config *Configuration, files []File, archives map[string][]ArchiveMember,
	catalog *ArcadeCatalog,
) ([]MissingROMMember, error) {
	result := []MissingROMMember{}
	if config.Content.Kind != "ARCADE" {
		return result, nil
	}
	entry := FindFile(files, *config.Content.EntryFile)
	if entry == nil {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	romSet := ConfiguredMachine(coreID, config, entry.Name)
	tree, err := arcadeAncestry(romSet, catalog)
	if err != nil {
		return nil, err
	}
	members := auditedMembers(tree, config.Core(coreID).Parents(), files, entry, archives)
	for index := range tree.Parents[0].Machine.ROMs {
		rom := &tree.Parents[0].Machine.ROMs[index]
		if rom.Optional || firmwareOwns(tree.Firmware, rom) {
			continue
		}
		role := "ROM"
		if inheritedFromParent(tree, rom) {
			role = "PARENT"
		}
		if missing := MissingMember(coreID, romSet, role, rom, members); missing != nil {
			result = append(result, *missing)
		}
	}
	return result, nil
}

// MissingMember reports a ROM absent from members, distinguishing a size mismatch of the named member.
func MissingMember(coreID, romSet, role string, rom *ArcadeROM, members []ArchiveMember) *MissingROMMember {
	if ROMMember(members, rom) != nil {
		return nil
	}
	reason := "MISSING"
	for _, member := range members {
		if member.Name == rom.Name || rom.Merge != "" && member.Name == rom.Merge {
			reason = "SIZE_MISMATCH"
			break
		}
	}
	return &MissingROMMember{
		CoreID: coreID, ROMSet: romSet, Role: role, Member: rom.Name, SizeBytes: rom.SizeBytes(),
		Reason: reason,
	}
}
