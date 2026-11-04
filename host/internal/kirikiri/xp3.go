package kirikiri

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"unicode/utf16"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

// Segment is one stored range of an XP3 resource.
type Segment struct {
	Mode     uint32
	Offset   int64
	Expanded int64
	Packed   int64
}

// InfoCorrection records a terminal info record whose size borrowed its File boundary.
type InfoCorrection struct {
	Declared int64 `json:"declared"`
	Actual   int64 `json:"actual"`
}

// Entry is one XP3 File record.
type Entry struct {
	Physical        string
	Name            string
	Size            int64
	Packed          int64
	Flags           uint32
	Segments        []Segment
	Readable        int64
	Adler           uint32
	Time            []byte
	InfoCorrection  *InfoCorrection
	H               uint32
	ReusedSeed      bool
	SeedOnly        bool
	WarningMetadata bool
}

func (e *Entry) storedSize() int64 {
	total := int64(0)
	for _, segment := range e.Segments {
		total += segment.Packed
	}
	return total
}

// Archive is a parsed XP3 namespace.
type Archive struct {
	Locator          *content.Locator
	SourceLocator    *content.Locator
	Format           string
	Salt             string
	Names            int
	Entries          []*Entry
	Omitted          []*Entry
	Unsupported      string
	ExtraIndexChunks [][]byte
	FilterSeedOnly   bool
}

func (a *Archive) source() *content.Locator {
	if a.SourceLocator != nil {
		return a.SourceLocator
	}
	return a.Locator
}

func (a *Archive) clone() *Archive {
	copied := *a
	copied.Entries = make([]*Entry, len(a.Entries))
	for index, entry := range a.Entries {
		duplicate := *entry
		copied.Entries[index] = &duplicate
	}
	return &copied
}

func indexes(ctx context.Context, handle *content.Handle, onTag func(string)) []row {
	require(bytes.Equal(readExact(handle, 0, int64(len(Magic))), Magic))
	position, total := number64(readExact(handle, 11, 8), 0), int64(0)
	visited := map[int64]bool{}
	var result []row
	for range 16 {
		if ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		require(position >= 19 && !visited[position])
		visited[position] = true
		flag := readExact(handle, position, 1)[0]
		position++
		require(flag&^0x81 == 0, "ARCHIVE_UNSUPPORTED")
		compressed := flag&1 != 0
		headerSize := int64(8)
		if compressed {
			headerSize = 16
		}
		header := readExact(handle, position, headerSize)
		position += headerSize
		packed := number64(header, 0)
		expanded := packed
		if compressed {
			expanded = number64(header, 8)
		}
		require(packed <= maximumIndex && expanded <= maximumIndex-total, "ARCHIVE_LIMIT")
		total += expanded
		data := readExact(handle, position, packed)
		position += packed
		if compressed {
			data = inflate(data, expanded)
		}
		result = append(result, chunks(data, onTag)...)
		if flag&0x80 == 0 {
			return result
		}
		position = number64(readExact(handle, position, 8), 0)
	}
	panic(fail("ARCHIVE_LIMIT"))
}

type fileFields struct {
	values     map[string]view
	correction *InfoCorrection
}

func fileRecords(data view, canonicalizeInfoSize bool) *fileFields {
	fields := &fileFields{values: map[string]view{}}
	for at := 0; at < len(data); {
		require(at+12 <= len(data))
		tag, declared, start := data.ascii(at, at+4), number64(data, at+4), at+12
		length := declared
		if canonicalizeInfoSize && tag == "info" && declared > int64(len(data)-start) && declared <= 22+32767*2+2 {
			// Only a terminal info record can borrow its enclosing File boundary.
			_, hasSegments := fields.values["segm"]
			_, hasChecksum := fields.values["adlr"]
			require(hasSegments && hasChecksum)
			length = int64(len(data) - start)
			fields.correction = &InfoCorrection{Declared: declared, Actual: length}
		}
		require(length <= int64(len(data)-start))
		_, duplicate := fields.values[tag]
		known := tag == "info" || tag == "segm" || tag == "adlr" || tag == "time"
		require(known && !duplicate, "ARCHIVE_UNSUPPORTED")
		fields.values[tag] = data[start : start+int(length)]
		at = start + int(length)
	}
	return fields
}

func parseFile(data view, sourceSize int64, canonicalizeInfoSize bool) *Entry {
	fields := fileRecords(data, canonicalizeInfoSize)
	info, segm, checksum := fields.values["info"], fields.values["segm"], fields.values["adlr"]
	timeField, hasTime := fields.values["time"]
	require(len(info) >= 22 && len(segm) > 0 && len(segm)%28 == 0 && len(checksum) == 4 &&
		(!hasTime || len(timeField) == 8))
	physical := text16(info, 22, info.u16(20), false)
	size, packed, flags := number64(info, 4), number64(info, 12), info.u32(0)
	require((flags == 0 || flags == 0x80000000) && size <= maximumFile && packed <= maximumFile, "ARCHIVE_UNSUPPORTED")
	entry := &Entry{
		Physical: physical, Name: physical, Size: size, Packed: packed, Flags: flags, Adler: checksum.u32(0),
		InfoCorrection: fields.correction,
	}
	if hasTime {
		entry.Time = append([]byte(nil), timeField...)
	}
	stored := parseSegments(entry, segm, sourceSize)
	consistent := stored == packed && entry.Readable == size
	require(stored <= packed && entry.Readable <= size && (consistent || shortWarningShape(entry)))
	return entry
}

func parseSegments(entry *Entry, segm view, sourceSize int64) int64 {
	stored := int64(0)
	for at := 0; at < len(segm); at += 28 {
		mode, offset := segm.u32(at), number64(segm, at+4)
		expanded, count := number64(segm, at+12), number64(segm, at+20)
		require((mode == 0 || mode == 1) && (mode != 0 || expanded == count) && offset >= 19 && offset <= sourceSize &&
			count <= sourceSize-offset)
		entry.Readable += expanded
		stored += count
		require(entry.Readable <= maximumFile && stored <= maximumFile, "ARCHIVE_LIMIT")
		entry.Segments = append(entry.Segments, Segment{Mode: mode, Offset: offset, Expanded: expanded, Packed: count})
	}
	return stored
}

var nameTags = []string{"eliF", "hnfn", "Yuzu", "neko"}

func isNameTag(tag string) bool {
	for _, item := range nameTags {
		if item == tag {
			return true
		}
	}
	return false
}

type nameRecord struct {
	name string
	h    uint32
}

func parseNames(rows []row) []nameRecord {
	seen := map[string]bool{}
	names := make([]nameRecord, 0, len(rows))
	for _, item := range rows {
		require(isNameTag(item.tag) && len(item.data) >= 6)
		name := normalizeName(text16(item.data, 6, item.data.u16(4), false))
		require(safeName(name) && !seen[name])
		seen[name] = true
		names = append(names, nameRecord{name, item.data.u32(0)})
	}
	return names
}

type nameTable struct {
	format string
	names  []nameRecord
	salt   string
}

func readNameTable(rows []row, handle *content.Handle) *nameTable {
	var descriptors []row
	for _, item := range rows {
		if item.tag == "sen:" {
			descriptors = append(descriptors, item)
		}
	}
	if len(descriptors) == 0 {
		var direct []row
		tags := map[string]bool{}
		for _, item := range rows {
			if isNameTag(item.tag) {
				direct = append(direct, item)
				tags[item.tag] = true
			}
		}
		require(len(tags) == 1)
		return &nameTable{format: "cxfilterfs-" + strings.ToLower(direct[0].tag), names: parseNames(direct)}
	}
	for _, item := range rows {
		require(item.tag == "sen:" || item.tag == "File")
	}
	require(len(descriptors) == 1)
	data := descriptors[0].data
	require(len(data) >= 18)
	offset, expanded, packed := number64(data, 0), int64(data.u32(8)), int64(data.u32(12))
	salt := text16(data, 18, data.u16(16), true)
	require(expanded <= maximumIndex && packed <= maximumIndex && offset >= 19)
	table := chunks(inflate(readExact(handle, offset, packed), expanded), nil)
	require(len(table) > 0)
	for _, item := range table {
		require(item.tag == "hnfn")
	}
	return &nameTable{format: "cxfilterfs-sen", names: parseNames(table), salt: salt}
}

var (
	filterScript = regexp.MustCompile(`(?i)(?:^|/)xp3filter\.tjs$`)
	hashedName   = regexp.MustCompile(`(?i)^[a-f\d]{32}$`)
)

func utf16le(text string) []byte {
	units := utf16.Encode([]rune(text))
	result := make([]byte, len(units)*2)
	for index, unit := range units {
		binary.LittleEndian.PutUint16(result[index*2:], unit)
	}
	return result
}

func linkEntries(files []*Entry, table *nameTable) ([]*Entry, []*Entry) {
	require(len(files) <= 250000 && len(table.names) > 0 && len(table.names) <= len(files), "ARCHIVE_LIMIT")
	physical := map[string]*Entry{}
	for _, file := range files {
		_, duplicate := physical[file.Physical]
		require(!duplicate)
		physical[file.Physical] = file
	}
	entries := make([]*Entry, 0, len(table.names))
	linked, seeds := map[string]bool{}, map[uint32]int{}
	for _, record := range table.names {
		sum := md5.Sum(utf16le(record.name + table.salt))
		key := hex.EncodeToString(sum[:])
		entry, found := physical[key]
		require(found && !linked[key], "NAME_MAP_INVALID")
		require(entry.Adler == record.h, "NAME_MAP_INVALID")
		require(!filterScript.MatchString(record.name), "ARCHIVE_UNSUPPORTED")
		linked[key] = true
		seeds[record.h]++
		copied := *entry
		copied.Name, copied.H = record.name, record.h
		entries = append(entries, &copied)
	}
	// The CxFilterFS namespace exposes only table names; an unlinked hashed entry means an incomplete table.
	var omitted []*Entry
	for _, file := range files {
		if !linked[file.Physical] {
			require(!hashedName.MatchString(file.Physical), "NAME_MAP_INVALID")
			omitted = append(omitted, file)
		}
	}
	seedOnly := len(seeds) == 1 && len(entries) > 1
	for _, entry := range entries {
		seedOnly = seedOnly && entry.Flags == 0x80000000 && entry.Readable == entry.Size
	}
	for _, entry := range entries {
		entry.ReusedSeed, entry.SeedOnly = seeds[entry.H] > 1, seedOnly
	}
	return entries, omitted
}

// ReadOptions select plain entries and info-size canonicalization.
type ReadOptions struct {
	IncludePlainEntries  bool
	CanonicalizeInfoSize bool
}

var protectedTags = []string{"eliF", "hnfn", "Yuzu", "neko", "sen:"}

func protectedTag(tag string) bool { return tag == "sen:" || isNameTag(tag) }

// ReadXP3 inspects immutable logical slices, including non-.xp3 names, without executing native code.
// It returns nil when the slice has no XP3 signature.
func ReadXP3(ctx context.Context, locator *content.Locator, options ReadOptions) (*Archive, error) {
	archive, err := guard(func() *Archive { return readXP3(ctx, locator, options) })
	if err == nil {
		return archive, nil
	}
	var failure *rules.Failure
	if ctx.Err() != nil || errors.As(err, &failure) && strings.HasPrefix(failure.Code, "RUNTIME_") {
		return nil, err
	}
	return nil, fail("ARCHIVE_INVALID")
}

func readXP3(ctx context.Context, locator *content.Locator, options ReadOptions) *Archive {
	if locator.SizeBytes < float64(len(Magic)) {
		return nil
	}
	handle, err := content.Open(locator)
	if err != nil {
		panic(asFailure(err))
	}
	defer func() { _ = handle.Close() }()
	if !bytes.Equal(readExact(handle, 0, int64(len(Magic))), Magic) {
		return nil
	}
	return readIndexed(ctx, locator, handle, options)
}

var unmatchedIndex = regexp.MustCompile(`^RUNTIME_KIRIKIRI_ARCHIVE_(?:INVALID|UNSUPPORTED|LIMIT)$`)

func archiveTags(rows []row) (map[string]bool, bool) {
	tags := map[string]bool{}
	for _, item := range rows {
		tags[item.tag] = true
	}
	protected := false
	for _, tag := range protectedTags {
		protected = protected || tags[tag]
	}
	return tags, protected
}

// indexRows reads the index; an uninspectable index without a known name-table tag is unmatched (nil).
func indexRows(ctx context.Context, handle *content.Handle, options ReadOptions) ([]row, bool) {
	matched := false
	rows, err := guard(func() []row {
		return indexes(ctx, handle, func(tag string) { matched = matched || protectedTag(tag) })
	})
	if err == nil {
		return rows, true
	}
	// An XP3 signature alone does not identify CxFilterFS; an index we cannot inspect is unmatched.
	var failure *rules.Failure
	if !matched && !options.IncludePlainEntries && ctx.Err() == nil && errors.As(err, &failure) &&
		unmatchedIndex.MatchString(failure.Code) {
		return nil, false
	}
	panic(err)
}

func readIndexed(ctx context.Context, locator *content.Locator, handle *content.Handle, options ReadOptions) *Archive {
	rows, inspected := indexRows(ctx, handle, options)
	if !inspected {
		return &Archive{Locator: locator}
	}
	tags, protected := archiveTags(rows)
	switch {
	case tags["Hxv4"] && !protected:
		return &Archive{Locator: locator, Unsupported: "hxv4"}
	case !protected && !options.IncludePlainEntries:
		return &Archive{Locator: locator}
	case protected:
		for _, item := range rows {
			require(item.tag == "File" || protectedTag(item.tag), "ARCHIVE_UNSUPPORTED")
		}
	}
	var files []*Entry
	for _, item := range rows {
		if item.tag == "File" {
			files = append(files, parseFile(item.data, int64(locator.SizeBytes), options.CanonicalizeInfoSize))
		}
	}
	if !protected {
		validateWarningMetadata(ctx, locator, files)
		return &Archive{Locator: locator, Entries: files}
	}
	table := readNameTable(rows, handle)
	entries, omitted := linkEntries(files, table)
	validateWarningMetadata(ctx, locator, entries)
	return &Archive{
		Locator: locator, Format: table.format, Salt: table.salt, Names: len(table.names), Entries: entries,
		Omitted: omitted,
	}
}

// shortWarningShape: protector warning metadata has an index marker and an independently readable raw notice.
func shortWarningShape(entry *Entry) bool {
	return entry.Flags == 0 && entry.Size <= 4096 && entry.Readable >= 32 && entry.Readable < entry.Size &&
		(entry.Packed == entry.Size || entry.Packed == entry.Readable) && len(entry.Segments) == 1 &&
		entry.Segments[0].Mode == 0
}

const warningPrefix = "$$$ this is a protected archive. $$$"

func validateWarningMetadata(ctx context.Context, locator *content.Locator, entries []*Entry) {
	for _, entry := range entries {
		if entry.Readable == entry.Size && entry.storedSize() == entry.Packed {
			continue
		}
		name := normalizeName(entry.Name)
		require(shortWarningShape(entry) && safeName(entry.Name) && safeName(name) &&
			strings.HasPrefix(name, warningPrefix) && strings.HasSuffix(name, ".txt"))
		body := readAll(ctx, locator, entry)
		text, ok := textcodec.Decode(body, "shift_jis", false)
		require(ok && int64(len(body)) == entry.Readable && strings.HasPrefix(text, "Warning: Extracting this archive"))
		for _, character := range text {
			require(character >= 32 && character != 127 || strings.ContainsRune("\t\r\n", character))
		}
		entry.WarningMetadata = true
	}
}
