package rules

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ArchiveMember is one ZIP central-directory member.
type ArchiveMember struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
	CRC32     string `json:"crc32"`
	SHA1      string `json:"sha1,omitempty"`
	SHA256    string `json:"sha256,omitempty"`
	File      string `json:"-"`
}

// ArcadeROM is one DAT ROM record.
type ArcadeROM struct {
	Name     string  `json:"name"`
	Size     string  `json:"size"`
	CRC      string  `json:"crc"`
	SHA1     *string `json:"sha1,omitempty"`
	Merge    string  `json:"merge,omitempty"`
	BIOS     string  `json:"bios,omitempty"`
	Optional bool    `json:"optional,omitempty"`
}

// SizeBytes mirrors Number(rom.size).
func (r *ArcadeROM) SizeBytes() float64 {
	text := strings.TrimSpace(r.Size)
	if text == "" {
		return 0
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return math.NaN()
	}
	return value
}

// ArcadeDisk is one DAT disk record.
type ArcadeDisk struct {
	Name     string  `json:"name"`
	SHA1     *string `json:"sha1"`
	Region   string  `json:"region"`
	Index    string  `json:"index"`
	Writable bool    `json:"writable"`
	Merge    string  `json:"merge,omitempty"`
	Optional bool    `json:"optional,omitempty"`
	Status   string  `json:"status,omitempty"`
}

// ArcadeMachine is one DAT machine.
type ArcadeMachine struct {
	Parent       *string      `json:"parent"`
	BIOS         bool         `json:"bios"`
	Device       bool         `json:"device,omitempty"`
	Runnable     *bool        `json:"runnable,omitempty"`
	Devices      []string     `json:"devices,omitempty"`
	Description  *string      `json:"description,omitempty"`
	Year         *string      `json:"year,omitempty"`
	Manufacturer *string      `json:"manufacturer,omitempty"`
	Disks        []ArcadeDisk `json:"disks,omitempty"`
	ROMs         []ArcadeROM  `json:"roms"`
}

// ParentID returns the parent machine or "".
func (m *ArcadeMachine) ParentID() string {
	if m == nil || m.Parent == nil {
		return ""
	}
	return *m.Parent
}

// ArcadeCatalog is one core's DAT keyed by machine, with JavaScript enumeration order.
type ArcadeCatalog struct {
	Names    []string
	Machines map[string]*ArcadeMachine
}

// UnmarshalJSON keeps JavaScript property order for enumerations.
func (c *ArcadeCatalog) UnmarshalJSON(data []byte) error {
	keys, values, err := ObjectKeys(data)
	if err != nil {
		return err
	}
	c.Names, c.Machines = keys, make(map[string]*ArcadeMachine, len(keys))
	for _, key := range keys {
		var machine ArcadeMachine
		if err := json.Unmarshal(values[key], &machine); err != nil {
			return fmt.Errorf("arcade machine %s: %w", key, err)
		}
		c.Machines[key] = &machine
	}
	return nil
}

// MarshalJSON writes the catalog as an object.
func (c *ArcadeCatalog) MarshalJSON() ([]byte, error) {
	encoded, err := json.Marshal(c.Machines)
	if err != nil {
		return nil, fmt.Errorf("arcade catalog: %w", err)
	}
	return encoded, nil
}

// Machine returns a machine or nil.
func (c *ArcadeCatalog) Machine(id string) *ArcadeMachine {
	if c == nil {
		return nil
	}
	return c.Machines[id]
}

// Playable reports a runnable non-BIOS, non-device machine.
func Playable(machine *ArcadeMachine) bool {
	return machine != nil && !machine.BIOS && !machine.Device && (machine.Runnable == nil || *machine.Runnable)
}

// ConfiguredMachine is the explicit ROM set or the entry archive basename.
func ConfiguredMachine(coreID string, config *Configuration, name string) string {
	if core := config.Core(coreID); core != nil && core.ROMSet != nil {
		return *core.ROMSet
	}
	return ArchiveID(name)
}

func sameROM(left, right *ArcadeROM) bool {
	return left.Size == right.Size && Lower(left.CRC) == Lower(right.CRC)
}

// ROMMember finds the archive member satisfying a DAT ROM.
func ROMMember(members []ArchiveMember, rom *ArcadeROM) *ArchiveMember {
	size := rom.SizeBytes()
	var named *ArchiveMember
	for index := range members {
		member := &members[index]
		if float64(member.SizeBytes) != size {
			continue
		}
		if Lower(member.CRC32) == Lower(rom.CRC) {
			return member
		}
		if named == nil && (member.Name == rom.Name || rom.Merge != "" && member.Name == rom.Merge) {
			named = member
		}
	}
	return named
}

type ancestor struct {
	ID      string
	Machine *ArcadeMachine
}

type ancestry struct {
	Parents  []ancestor
	Devices  []ancestor
	Firmware []*ArcadeROM
}

// deviceWalk orders required devices after their own devices; cycles and unknown devices are invalid.
type deviceWalk struct {
	catalog           *ArcadeCatalog
	visited, visiting map[string]bool
	order             []ancestor
}

func (w *deviceWalk) visit(id string) error {
	if w.visiting[id] {
		return Fail("RUNTIME_ARCADE_CATALOG_INVALID")
	}
	if w.visited[id] {
		return nil
	}
	machine := w.catalog.Machine(id)
	if machine == nil || !machine.Device || len(w.visiting) >= 128 {
		return Fail("RUNTIME_ARCADE_CATALOG_INVALID")
	}
	w.visiting[id] = true
	for _, child := range machine.Devices {
		if err := w.visit(child); err != nil {
			return err
		}
	}
	delete(w.visiting, id)
	w.visited[id] = true
	w.order = append(w.order, ancestor{id, machine})
	return nil
}

// arcadeAncestry resolves parents and required devices; only their firmware may satisfy inherited ownership.
func arcadeAncestry(machineID string, catalog *ArcadeCatalog) (*ancestry, error) {
	result := &ancestry{Parents: []ancestor{{machineID, catalog.Machine(machineID)}}}
	seen := map[string]bool{machineID: true}
	for result.Parents[len(result.Parents)-1].Machine.ParentID() != "" {
		id := result.Parents[len(result.Parents)-1].Machine.ParentID()
		machine := catalog.Machine(id)
		if machine == nil || seen[id] || len(seen) >= 32 {
			return nil, Fail("RUNTIME_ARCADE_CATALOG_INVALID")
		}
		seen[id] = true
		result.Parents = append(result.Parents, ancestor{id, machine})
	}
	devices := &deviceWalk{catalog: catalog, visited: map[string]bool{}, visiting: map[string]bool{}}
	for _, parent := range result.Parents {
		for _, id := range parent.Machine.Devices {
			if err := devices.visit(id); err != nil {
				return nil, err
			}
		}
	}
	result.Devices = devices.order
	for _, parent := range result.Parents {
		if parent.Machine.BIOS {
			result.Firmware = appendROMs(result.Firmware, parent.Machine)
		}
	}
	for _, device := range result.Devices {
		result.Firmware = appendROMs(result.Firmware, device.Machine)
	}
	return result, nil
}

func appendROMs(roms []*ArcadeROM, machine *ArcadeMachine) []*ArcadeROM {
	for index := range machine.ROMs {
		roms = append(roms, &machine.ROMs[index])
	}
	return roms
}

func firmwareOwns(firmware []*ArcadeROM, rom *ArcadeROM) bool {
	for _, other := range firmware {
		if sameROM(rom, other) && (rom.Name == other.Name || rom.Merge != "" && rom.Merge == other.Name) {
			return true
		}
	}
	return false
}

// ArcadeDependencies are the Parent payloads and independent firmware sets of an arcade game.
type ArcadeDependencies struct {
	ParentFiles    []string `json:"parentFiles"`
	MissingParents []string `json:"missingParents"`
	BIOSSets       []string `json:"biosSets"`
}

// Dependencies matches Parent payloads against actual members; DAT firmware is delivered independently.
func Dependencies(coreID string, config *Configuration, files []File, archives map[string][]ArchiveMember,
	catalog *ArcadeCatalog, provenance []map[string]any,
) (*ArcadeDependencies, error) {
	result := &ArcadeDependencies{ParentFiles: []string{}, MissingParents: []string{}, BIOSSets: []string{}}
	if config.Content.Kind != "ARCADE" {
		return result, nil
	}
	entry := FindFile(files, *config.Content.EntryFile)
	if entry == nil {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	machineID := ConfiguredMachine(coreID, config, entry.Name)
	if !Playable(catalog.Machine(machineID)) {
		return nil, Fail("RUNTIME_ARCADE_MACHINE_UNKNOWN", "machine", machineID)
	}
	gameMembers, exists := archives[entry.LogicalKey]
	if !exists {
		return nil, Fail("RUNTIME_ARCHIVE_EVIDENCE_REQUIRED")
	}
	configured := config.Core(coreID).Parents()
	available := append([]ArchiveMember(nil), gameMembers...)
	tree, err := arcadeAncestry(machineID, catalog)
	if err != nil {
		return nil, err
	}
	for index := 1; index < len(tree.Parents); index++ {
		current, parent := tree.Parents[index-1].Machine, tree.Parents[index]
		if parent.Machine.BIOS {
			result.BIOSSets = append(result.BIOSSets, parent.ID)
			continue
		}
		inherited := inheritedROMs(current, parent.Machine, tree.Firmware)
		if !needsParent(coreID, index == 1, inherited, available, provenance) {
			continue
		}
		file := parentFile(files, configured, parent.ID)
		members, hasMembers := archives[fileKey(file)]
		if file == nil || !hasMembers || !hasAllROMs(append(append([]ArchiveMember(nil), available...), members...),
			inherited) {
			result.MissingParents = append(result.MissingParents, parent.ID)
		} else {
			result.ParentFiles = append(result.ParentFiles, file.LogicalKey)
			available = append(available, members...)
		}
	}
	for _, device := range tree.Devices {
		if hasRequiredROM(device.Machine) && !contains(result.BIOSSets, device.ID) {
			result.BIOSSets = append(result.BIOSSets, device.ID)
		}
	}
	return result, nil
}

func fileKey(file *File) string {
	if file == nil {
		return "\x00"
	}
	return file.LogicalKey
}

func parentFile(files []File, configured []string, parentID string) *File {
	for index := range files {
		if contains(configured, files[index].LogicalKey) && ArchiveID(files[index].Name) == parentID {
			return &files[index]
		}
	}
	return nil
}

func hasRequiredROM(machine *ArcadeMachine) bool {
	for index := range machine.ROMs {
		if !machine.ROMs[index].Optional {
			return true
		}
	}
	return false
}

func inheritedROMs(current, parent *ArcadeMachine, firmware []*ArcadeROM) []*ArcadeROM {
	var inherited []*ArcadeROM
	for index := range current.ROMs {
		rom := &current.ROMs[index]
		if rom.Optional || firmwareOwns(firmware, rom) {
			continue
		}
		if rom.Merge != "" || machineHasROM(parent, rom) {
			inherited = append(inherited, rom)
		}
	}
	return inherited
}

func machineHasROM(machine *ArcadeMachine, rom *ArcadeROM) bool {
	for index := range machine.ROMs {
		if sameROM(rom, &machine.ROMs[index]) {
			return true
		}
	}
	return false
}

func hasAllROMs(members []ArchiveMember, roms []*ArcadeROM) bool {
	for _, rom := range roms {
		if ROMMember(members, rom) == nil {
			return false
		}
	}
	return true
}

// needsParent: the pinned CPS2 loader opens its named parent archive before looking at clone members.
func needsParent(coreID string, direct bool, inherited []*ArcadeROM, members []ArchiveMember,
	provenance []map[string]any,
) bool {
	if direct {
		for _, source := range provenance {
			if source["coreId"] == coreID && source["requiresParentArchive"] == true {
				return true
			}
		}
	}
	return !hasAllROMs(members, inherited)
}
