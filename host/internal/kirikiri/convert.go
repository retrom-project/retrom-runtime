package kirikiri

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

// AuditRow is one temporary conversion audit record.
type AuditRow map[string]any

// Auditor receives audit rows.
type Auditor func(AuditRow)

type writer struct{ file *os.File }

func (w *writer) write(data []byte) {
	for at := 0; at < len(data); {
		written, err := w.file.Write(data[at:])
		require(err == nil && written > 0)
		at += written
	}
}

func fileRecord(entry *Entry, offset, size int64, checksum uint32) []byte {
	name := utf16le(entry.Name)
	info := make([]byte, 22, 22+len(name))
	binary.LittleEndian.PutUint64(info[4:], uint64(size))
	binary.LittleEndian.PutUint64(info[12:], uint64(size))
	binary.LittleEndian.PutUint16(info[20:], uint16(len(name)/2))
	segment := make([]byte, 28)
	binary.LittleEndian.PutUint64(segment[4:], uint64(offset))
	binary.LittleEndian.PutUint64(segment[12:], uint64(size))
	binary.LittleEndian.PutUint64(segment[20:], uint64(size))
	body := append(chunkBytes("info", append(info, name...)), chunkBytes("segm", segment)...)
	body = append(body, chunkBytes("adlr", u32bytes(checksum))...)
	if entry.Time != nil {
		body = append(body, chunkBytes("time", entry.Time)...)
	}
	return chunkBytes("File", body)
}

type transformResult struct {
	size                    int64
	checksum                uint32
	sha256, rawSHA256       string
	corrections             []string
	sourceIntegrityVerified bool
	filterStage             string
}

func transformed(ctx context.Context, archive *Archive, entry *Entry, filter *Filter, target *writer) *transformResult {
	if archive.Format == "xp3-native" && (entry.SeedOnly || archive.FilterSeedOnly) {
		return seedTransformed(ctx, archive, entry, filter, target)
	}
	var stage *selectedStage
	if filter.Stages != nil && entry.Flags == 0x80000000 {
		stage = selectResourceStage(ctx, archive.Locator, entry, filter)
	}
	result := streamTransformed(ctx, archive, entry, transform(entry, filter, stage), target)
	classifyCorrections(result, entry, filter)
	require(stage == nil || stage.sha256 == result.sha256 && stage.rawSHA256 == result.rawSHA256, "SOURCE_CHANGED")
	result.sourceIntegrityVerified = len(result.corrections) == 0
	if entry.InfoCorrection != nil {
		require(result.sourceIntegrityVerified && result.checksum == entry.Adler, "CHECKSUM_MISMATCH")
		result.corrections = append(result.corrections, "INFO_CHUNK_SIZE")
	}
	if stage != nil {
		result.filterStage = stage.ID
	}
	return result
}

func transform(entry *Entry, filter *Filter, stage *selectedStage) func([]byte, uint32, int64) {
	switch {
	case entry.WarningMetadata:
		return func([]byte, uint32, int64) {}
	case stage != nil:
		return stage.Apply
	default:
		return func(data []byte, seed uint32, offset int64) { filter.Apply(data, seed, offset, entry) }
	}
}

func streamTransformed(ctx context.Context, archive *Archive, entry *Entry, apply func([]byte, uint32, int64),
	target *writer,
) *transformResult {
	raw, decoded := sha256.New(), sha256.New()
	size, checksum := int64(0), uint32(1)
	resourceBytes(ctx, archive.Locator, entry, func(data []byte) {
		raw.Write(data)
		apply(data, entry.H, size)
		checksum = adler32(data, checksum)
		decoded.Write(data)
		size += int64(len(data))
		require(size <= entry.Readable)
		target.write(data)
	})
	require(size == entry.Readable)
	return &transformResult{
		size: size, checksum: checksum, corrections: []string{},
		sha256: hex.EncodeToString(decoded.Sum(nil)), rawSHA256: hex.EncodeToString(raw.Sum(nil)),
	}
}

// classifyCorrections records audited metadata exceptions; they are never decoded source checksum passes.
func classifyCorrections(result *transformResult, entry *Entry, filter *Filter) {
	if result.size != entry.Size || entry.storedSize() != entry.Packed {
		require(filter.Verified && entry.WarningMetadata)
		result.corrections = append(result.corrections, "FORMAT_WARNING_SHORT_STREAM")
	}
	if result.checksum != entry.Adler && len(result.corrections) == 0 {
		// Modified CxFilterFS tables can reuse h as a filter seed the native reader does not validate.
		require(filter.Kind == "tiny" && entry.SeedOnly && filter.Verified, "CHECKSUM_MISMATCH")
		result.corrections = append(result.corrections, "REUSED_FILTER_SEED")
	}
}

func seedTransformed(ctx context.Context, archive *Archive, entry *Entry, filter *Filter,
	target *writer,
) *transformResult {
	expected := entry.Flags == 0 && entry.Adler == 0
	if archive.FilterSeedOnly {
		expected = entry.Flags == 0x80000000
	}
	require(filter.Verified && expected && entry.InfoCorrection == nil && entry.Readable <= 32*1024*1024,
		"CHECKSUM_MISMATCH")
	raw := readAll(ctx, archive.Locator, entry)
	var output []byte
	correction := "REUSED_FILTER_SEED"
	if archive.FilterSeedOnly {
		output, correction = resolveFilteredSeed(raw, filter, entry.H), "FILTER_SEED_ONLY"
		require(adler32(output, 1) != entry.Adler, "SOURCE_CHANGED")
	} else {
		output = resolveSeedOnly(raw, filter, entry.H)
	}
	target.write(output)
	return &transformResult{
		size: int64(len(output)), checksum: adler32(output, 1), sha256: digest(output),
		rawSHA256: digest(raw), corrections: []string{correction},
	}
}

type expectedEntry struct {
	name     string
	size     int64
	checksum uint32
	sha256   string
}

func verifyOutput(ctx context.Context, path string, entries []expectedEntry) (int64, string) {
	info, err := os.Stat(path)
	require(err == nil)
	locator := &content.Locator{Path: path, SizeBytes: float64(info.Size())}
	archive, err := ReadXP3(ctx, locator, ReadOptions{IncludePlainEntries: true})
	if err != nil {
		panic(err)
	}
	require(archive != nil && archive.Format == "" && len(archive.Entries) == len(entries), "OUTPUT_MISMATCH")
	for index, expected := range entries {
		entry := archive.Entries[index]
		require(entry.Name == expected.name && entry.Size == expected.size && entry.Adler == expected.checksum &&
			entry.Flags == 0, "OUTPUT_MISMATCH")
		count, checksum, hash := int64(0), uint32(1), sha256.New()
		resourceBytes(ctx, locator, entry, func(data []byte) {
			count += int64(len(data))
			checksum = adler32(data, checksum)
			hash.Write(data)
		})
		require(count == expected.size && checksum == expected.checksum &&
			hex.EncodeToString(hash.Sum(nil)) == expected.sha256, "OUTPUT_MISMATCH")
	}
	return info.Size(), sourceHash(ctx, locator)
}

// ConvertResult is one converted archive.
type ConvertResult struct {
	SizeBytes            int64
	SHA256               string
	VerifiedEntries      int
	MetadataCorrections  int
	OmittedPhysicalEntry int
}

// ConvertXP3 streams one protected logical namespace to an ordinary, independently reread XP3.
func ConvertXP3(ctx context.Context, archive *Archive, file *rules.File, path string, filter *Filter, audit Auditor,
) *ConvertResult {
	require(sourceHash(ctx, archive.source()) == file.SHA256, "SOURCE_CHANGED")
	handle, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		panic(fmt.Errorf("kirikiri output: %w", err))
	}
	target := &writer{file: handle}
	records := append([][]byte(nil), archive.ExtraIndexChunks...)
	var expected []expectedEntry
	position, indexSize := int64(19), 0
	for _, record := range records {
		indexSize += len(record)
	}
	require(indexSize <= maximumIndex, "ARCHIVE_LIMIT")
	result := &ConvertResult{}
	func() {
		defer func() { _ = handle.Close() }()
		target.write(append(append([]byte(nil), Magic...), make([]byte, 8)...))
		for _, entry := range archive.Entries {
			if ctx.Err() != nil {
				panic(rules.Fail("RUNTIME_CANCELLED"))
			}
			require(position+entry.Readable <= maximumFile, "ARCHIVE_LIMIT")
			item := transformed(ctx, archive, entry, filter, target)
			record := fileRecord(entry, position, item.size, item.checksum)
			records = append(records, record)
			indexSize += len(record)
			require(indexSize <= maximumIndex, "ARCHIVE_LIMIT")
			expected = append(expected, expectedEntry{entry.Name, item.size, item.checksum, item.sha256})
			position += item.size
			if len(item.corrections) > 0 {
				result.MetadataCorrections++
			} else {
				result.VerifiedEntries++
			}
			audit(resourceAudit(file, entry, item))
		}
		require(position+9+int64(indexSize) <= maximumFile, "ARCHIVE_LIMIT")
		target.write(append([]byte{0}, uint64Bytes(int64(indexSize))...))
		for _, record := range records {
			target.write(record)
		}
		written, err := handle.WriteAt(uint64Bytes(position), 11)
		require(err == nil && written == 8)
		require(handle.Sync() == nil)
	}()
	for _, entry := range archive.Omitted {
		hash, count := sha256.New(), int64(0)
		resourceBytes(ctx, archive.Locator, entry, func(data []byte) {
			count += int64(len(data))
			hash.Write(data)
		})
		audit(AuditRow{
			"archive": file.LogicalKey, "kind": "physical-only", "physicalName": entry.Physical,
			"sourceSize": entry.Size, "readableSize": count, "sourceFlags": entry.Flags, "sourceAdler32": entry.Adler,
			"rawStreamSha256": hex.EncodeToString(hash.Sum(nil)), "reason": "OUTSIDE_LOGICAL_NAMESPACE",
		})
	}
	result.SizeBytes, result.SHA256 = verifyOutput(ctx, path, expected)
	require(sourceHash(ctx, archive.source()) == file.SHA256, "SOURCE_CHANGED")
	result.OmittedPhysicalEntry = len(archive.Omitted)
	return result
}

func resourceAudit(file *rules.File, entry *Entry, item *transformResult) AuditRow {
	row := AuditRow{
		"archive": file.LogicalKey, "kind": "resource", "logicalName": entry.Name, "physicalName": entry.Physical,
		"sourceSize": entry.Size, "sourcePackedSize": entry.Packed, "sourceAdler32": entry.Adler, "sourceSeed": entry.H,
		"sourceFlags": entry.Flags, "outputSize": item.size, "outputAdler32": item.checksum, "outputSha256": item.sha256,
		"rawStreamSha256": item.rawSHA256, "sourceIntegrityVerified": item.sourceIntegrityVerified,
		"corrections": item.corrections,
	}
	if entry.InfoCorrection != nil {
		row["infoSizeCorrection"] = entry.InfoCorrection
	}
	if item.filterStage != "" {
		row["filterStage"] = item.filterStage
	}
	return row
}
