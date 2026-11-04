package rules

import (
	"encoding/binary"
	"encoding/hex"
	"regexp"
	"sort"
	"strings"
)

// CHDHeader is the identity of a CHD image header.
type CHDHeader struct {
	SHA1       string  `json:"sha1"`
	ParentSHA1 *string `json:"parentSHA1"`
}

// DiskRequirement is one DAT disk at its logical media path.
type DiskRequirement struct {
	Path string
	Disk *ArcadeDisk
}

var sha1Pattern = regexp.MustCompile(`(?i)^[0-9a-f]{40}$`)

// DiskRequirements lists DAT disk facts, including clone/parent media, independent of source layout.
func DiskRequirements(machine string, catalog *ArcadeCatalog) ([]DiskRequirement, error) {
	seen := map[string]bool{}
	for current := machine; current != ""; {
		if seen[current] || len(seen) >= 32 {
			return nil, Fail("RUNTIME_ARCADE_CATALOG_INVALID")
		}
		seen[current] = true
		record := catalog.Machine(current)
		if record == nil || record.BIOS {
			return nil, nil
		}
		if len(record.Disks) > 0 {
			result := make([]DiskRequirement, 0, len(record.Disks))
			for index := range record.Disks {
				disk := &record.Disks[index]
				path := machine + "/" + disk.Name + ".chd"
				if !LogicalPath(path, false) || strings.Contains(disk.Name, "/") ||
					disk.SHA1 != nil && !sha1Pattern.MatchString(*disk.SHA1) {
					return nil, Fail("RUNTIME_ARCADE_CATALOG_INVALID")
				}
				result = append(result, DiskRequirement{path, disk})
			}
			return result, nil
		}
		current = record.ParentID()
	}
	return nil, nil
}

// Media is the selected media mapping for an arcade game.
type Media struct {
	MediaFiles   []string          `json:"mediaFiles"`
	MissingMedia []string          `json:"missingMedia"`
	MediaPaths   map[string]string `json:"mediaPaths"`
}

func emptyMedia() *Media {
	return &Media{MediaFiles: []string{}, MissingMedia: []string{}, MediaPaths: map[string]string{}}
}

// diskCandidates are the non-entry CHD files whose header SHA-1 matches the disk, in selection order.
func diskCandidates(files []File, entryFile string, disk *ArcadeDisk, path string, headers map[string]CHDHeader,
) []*File {
	var candidates []*File
	for index := range files {
		file := &files[index]
		header, known := headers[file.LogicalKey]
		if file.LogicalKey != entryFile && disk.SHA1 != nil && *disk.SHA1 != "" && known && header.SHA1 == *disk.SHA1 {
			candidates = append(candidates, file)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return mediaBefore(candidates[i].LogicalKey, candidates[j].LogicalKey, path, headers)
	})
	return candidates
}

// ArcadeMedia maps CHD files by header identity to the DAT disk paths of the selected machine.
func ArcadeMedia(coreID string, config *Configuration, files []File, catalog *ArcadeCatalog,
	headers map[string]CHDHeader,
) (*Media, error) {
	result := emptyMedia()
	if coreID != "mame_arcade" || config.Content.Kind != "ARCADE" {
		return result, nil
	}
	entryFile := *config.Content.EntryFile
	entry := FindFile(files, entryFile)
	if entry == nil {
		return nil, Fail("RUNTIME_ENTRY_MISSING")
	}
	requirements, err := DiskRequirements(ConfiguredMachine(coreID, config, entry.Name), catalog)
	if err != nil {
		return nil, err
	}
	for _, requirement := range requirements {
		path, disk := requirement.Path, requirement.Disk
		candidates := diskCandidates(files, entryFile, disk, path, headers)
		if len(candidates) == 0 {
			if !disk.Optional {
				result.MissingMedia = append(result.MissingMedia, path)
			}
			continue
		}
		selected := candidates[0].LogicalKey
		if parent := headers[selected].ParentSHA1; parent != nil {
			return nil, Fail("RUNTIME_ARCADE_DISK_PARENT_REQUIRED", "file", path, "sha1", *parent)
		}
		if existing, mapped := result.MediaPaths[selected]; mapped && existing != path {
			return nil, Fail("RUNTIME_ARCADE_DISK_AMBIGUOUS", "file", path)
		}
		result.MediaFiles = append(result.MediaFiles, selected)
		result.MediaPaths[selected] = path
	}
	return result, nil
}

// mediaBefore prefers self-contained images, then the exact DAT path, then lexical order.
func mediaBefore(left, right, path string, headers map[string]CHDHeader) bool {
	leftParent, rightParent := headers[left].ParentSHA1 != nil, headers[right].ParentSHA1 != nil
	if leftParent != rightParent {
		return !leftParent
	}
	if (left == path) != (right == path) {
		return left == path
	}
	return UTF16Less(left, right)
}

// RequireArcadeMedia fails on missing required disks.
func RequireArcadeMedia(media *Media) error {
	if len(media.MissingMedia) > 0 {
		return Fail("RUNTIME_ARCADE_DISK_MISSING", "files", strings.Join(media.MissingMedia, ","))
	}
	return nil
}

var chdLayouts = map[uint32][3]int{3: {120, 80, 100}, 4: {108, 48, 68}, 5: {124, 84, 104}}

// ParseCHDHeader reads header identity; it is not an integrity audit of compressed blocks.
func ParseCHDHeader(data []byte, sizeBytes int64) (*CHDHeader, error) {
	invalid := Fail("RUNTIME_ARCADE_DISK_INVALID")
	version := uint32(0)
	if len(data) >= 16 {
		version = binary.BigEndian.Uint32(data[12:])
	}
	layout, known := chdLayouts[version]
	if !known || len(data) < layout[0] || sizeBytes <= int64(layout[0]) ||
		binary.BigEndian.Uint32(data[8:]) != uint32(layout[0]) || string(data[:8]) != "MComprHD" {
		return nil, invalid
	}
	if !validCHDGeometry(data, version, layout[0], sizeBytes) {
		return nil, invalid
	}
	sha1 := hex.EncodeToString(data[layout[1] : layout[1]+20])
	parent := hex.EncodeToString(data[layout[2] : layout[2]+20])
	if strings.Trim(sha1, "0") == "" {
		return nil, invalid
	}
	header := &CHDHeader{SHA1: sha1}
	if strings.Trim(parent, "0") != "" {
		header.ParentSHA1 = &parent
	}
	return header, nil
}

// chdOffsetsInside: every nonzero map/metadata offset lies after the header and inside the file.
func chdOffsetsInside(data []byte, version uint32, headerBytes int, sizeBytes int64) bool {
	offsets := []int{36}
	if version == 5 {
		offsets = []int{40, 48}
	}
	for _, offset := range offsets {
		position := binary.BigEndian.Uint64(data[offset:])
		if position != 0 && (position < uint64(headerBytes) || position >= uint64(sizeBytes)) {
			return false
		}
	}
	return true
}

func validCHDGeometry(data []byte, version uint32, headerBytes int, sizeBytes int64) bool {
	logicalOffset, hunkOffset := 28, 44
	switch version {
	case 5:
		logicalOffset, hunkOffset = 32, 56
	case 3:
		hunkOffset = 76
	}
	logical := binary.BigEndian.Uint64(data[logicalOffset:])
	hunk := binary.BigEndian.Uint32(data[hunkOffset:])
	if sizeBytes > 1<<53-1 || logical < 1 || logical > 1<<53-1 || hunk < 1 || hunk > 524288 {
		return false
	}
	if !chdOffsetsInside(data, version, headerBytes, sizeBytes) {
		return false
	}
	if version == 5 {
		unit := binary.BigEndian.Uint32(data[60:])
		return unit != 0 && unit <= hunk && hunk%unit == 0
	}
	return uint64(binary.BigEndian.Uint32(data[24:])) == (logical+uint64(hunk)-1)/uint64(hunk)
}
