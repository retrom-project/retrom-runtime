package kirikiri

import (
	"context"
	"errors"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

func archiveFailure(err error) bool {
	var failure *rules.Failure
	return errors.As(err, &failure) && strings.HasPrefix(failure.Code, "RUNTIME_KIRIKIRI_ARCHIVE_")
}

// readOrNil reads an archive and treats a KiriKiri archive-format failure as unmatched.
func readOrNil(ctx context.Context, locator *content.Locator, options ReadOptions) *Archive {
	archive, err := ReadXP3(ctx, locator, options)
	if err != nil {
		if ctx.Err() != nil || !archiveFailure(err) {
			panic(err)
		}
		return nil
	}
	return archive
}

// ordinaryArchive reads a non-CxFilterFS archive with canonicalized info sizes, or returns nil.
func ordinaryArchive(ctx context.Context, locator *content.Locator) *Archive {
	archive := readOrNil(ctx, locator, ReadOptions{IncludePlainEntries: true, CanonicalizeInfoSize: true})
	if archive == nil || archive.Format != "" || len(archive.Entries) == 0 {
		return nil
	}
	seedOnly := len(archive.Entries) > 1
	for _, entry := range archive.Entries {
		seedOnly = seedOnly && entry.Flags == 0 && entry.Adler == 0
	}
	result := archive.clone()
	result.Omitted = nil
	for _, entry := range result.Entries {
		entry.H, entry.SeedOnly = entry.Adler, seedOnly
	}
	return result
}

type fixedResult struct {
	plaintext bool
	archive   *Archive
	filter    *Filter
}

type probeSample struct {
	data  []byte
	adler uint32
}

// fixedSamples collects up to eight distinct protected samples and up to eight short ones.
func fixedSamples(ctx context.Context, archive *Archive) ([]probeSample, []probeSample) {
	seeds := map[uint32]bool{}
	var probes, short []probeSample
	for _, entry := range archive.Entries {
		if entry.Flags != 0x80000000 || entry.Size > 4*1024*1024 || seeds[entry.Adler] || entry.Size < 32 && len(short) == 8 {
			continue
		}
		sample := probeSample{data: readAll(ctx, archive.Locator, entry), adler: entry.Adler}
		if entry.Size < 32 {
			short = append(short, sample)
		} else {
			probes = append(probes, sample)
		}
		seeds[entry.Adler] = true
		if len(probes) == 8 {
			break
		}
	}
	return probes, short
}

func plaintextSamples(samples []probeSample) bool {
	for _, sample := range samples {
		if adler32(sample.data, 1) != sample.adler {
			return false
		}
	}
	return len(samples) > 0
}

// uniqueXorKey returns the only nonzero byte key authenticating every probe, or -1.
func uniqueXorKey(ctx context.Context, probes []probeSample) int {
	key := -1
	for candidate := 1; candidate < 256; candidate++ {
		if ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		if !xorMatches(probes, byte(candidate)) {
			continue
		}
		if key >= 0 {
			return -1
		}
		key = candidate
	}
	return key
}

// fixedXorArchive accepts a fixed byte XOR only after three complete, distinct checksums authenticate it.
func fixedXorArchive(ctx context.Context, archive *Archive) *fixedResult {
	if archive == nil || archive.Format != "" || len(archive.Entries) == 0 {
		return nil
	}
	probes, short := fixedSamples(ctx, archive)
	if plaintextSamples(append(append([]probeSample(nil), probes...), short...)) {
		return &fixedResult{plaintext: true}
	}
	if len(probes) < 3 {
		return nil
	}
	key := uniqueXorKey(ctx, probes)
	if key < 0 {
		return nil
	}
	for _, entry := range archive.Entries {
		require(safeName(entry.Name), "ARCHIVE_UNSUPPORTED")
	}
	result := archive.clone()
	result.Format, result.Omitted = "xp3-fixed-xor", nil
	for _, entry := range result.Entries {
		entry.H = entry.Adler
	}
	value := byte(key)
	return &fixedResult{archive: result, filter: &Filter{
		Kind: "fixed-xor", Verified: true,
		Profile: map[string]any{"key": key}, Apply: func(data []byte, _ uint32, _ int64, entry *Entry) {
			if entry == nil {
				panic(internal("Cannot read properties of undefined (reading 'flags')"))
			}
			if entry.Flags == 0x80000000 {
				for index := range data {
					data[index] ^= value
				}
			}
		},
	}}
}

func xorMatches(probes []probeSample, key byte) bool {
	for _, sample := range probes {
		decoded := append([]byte(nil), sample.data...)
		for index := range decoded {
			decoded[index] ^= key
		}
		if adler32(decoded, 1) != sample.adler {
			return false
		}
	}
	return true
}

func seedOnlyCandidate(archive *Archive, filter *Filter) bool {
	entries := archive.Entries
	seeds := map[uint32]bool{}
	for _, entry := range entries {
		seeds[entry.H] = true
	}
	if !filter.Verified || filter.Stages != nil || len(entries) < 3 || len(seeds) < 3 {
		return false
	}
	for _, entry := range entries {
		if entry.Flags != 0x80000000 || entry.Size != entry.Readable || entry.InfoCorrection != nil ||
			entry.Size > 32*1024*1024 {
			return false
		}
	}
	return true
}

// filteredSeedMismatch reports whether a raw record fails to resolve to a supported decoded representation.
func filteredSeedMismatch(raw []byte, filter *Filter, seed uint32) bool {
	err := check(func() { resolveFilteredSeed(raw, filter, seed) })
	if err == nil {
		return false
	}
	var failure *rules.Failure
	if errors.As(err, &failure) && failure.Code == "RUNTIME_KIRIKIRI_CHECKSUM_MISMATCH" {
		return true
	}
	panic(err)
}

// seedMetadataArchive: a whole native archive may use adlr only as a filter seed, proven per record.
func seedMetadataArchive(ctx context.Context, archive *Archive, filter *Filter) *Archive {
	if !seedOnlyCandidate(archive, filter) {
		return archive
	}
	for _, entry := range archive.Entries {
		if ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		raw := readAll(ctx, archive.Locator, entry)
		decoded := append([]byte(nil), raw...)
		filter.Apply(decoded, entry.H, 0, nil)
		// A single genuine checksum makes this a checksummed archive.
		if adler32(decoded, 1) == entry.Adler || filteredSeedMismatch(raw, filter, entry.H) {
			return archive
		}
	}
	result := *archive
	result.FilterSeedOnly = true
	return &result
}

const maximumModule = 64 * 1024 * 1024

type peHeaders struct {
	at, count, optional int64
	headers             view
}

// readPEHeaders reads the PE header and section table, or returns nil.
func readPEHeaders(handle *content.Handle, size int64) *peHeaders {
	dos := readExact(handle, 0, 64)
	at := int64(dos.u32(60))
	if dos.ascii(0, 2) != "MZ" || at < 64 || at > 1024*1024 || at+24 > size {
		return nil
	}
	header := readExact(handle, at, 24)
	count, optional := int64(header.u16(6)), int64(header.u16(20))
	if header.u32(0) != 0x4550 || count == 0 || count > 96 || optional < 64 || at+24+optional+count*40 > size {
		return nil
	}
	return &peHeaders{at: at, count: count, optional: optional, headers: readExact(handle, at+24, optional+count*40)}
}

func (h *peHeaders) section(index int64) (int64, int64) {
	position := int(h.optional + index*40)
	return int64(h.headers.u32(position + 20)), int64(h.headers.u32(position + 16))
}

// nativeModule inspects the complete bounded PE image without materializing an opaque appended payload.
func nativeModule(locator *content.Locator) []byte {
	handle, err := content.Open(locator)
	if err != nil {
		panic(asFailure(err))
	}
	defer func() { _ = handle.Close() }()
	size := int64(locator.SizeBytes)
	if size <= maximumModule {
		return readExact(handle, 0, size)
	}
	pe := readPEHeaders(handle, size)
	if pe == nil || pe.headers.u16(0) != 0x10b {
		return nil
	}
	end := pe.at + 24 + int64(len(pe.headers))
	for index := range pe.count {
		start, length := pe.section(index)
		if length > size-start {
			return nil
		}
		if length > 0 {
			end = max(end, start+length)
		}
	}
	if end > maximumModule {
		return nil
	}
	return readExact(handle, 0, end)
}

// peXP3 finds a file-backed XP3 overlay after valid PE sections within one logical source slice, or returns nil.
func peXP3(ctx context.Context, locator *content.Locator) *Archive {
	if locator.SizeBytes < 64 {
		return nil
	}
	handle, err := content.Open(locator)
	if err != nil {
		panic(asFailure(err))
	}
	defer func() { _ = handle.Close() }()
	end, ok := overlayStart(handle, int64(locator.SizeBytes))
	if !ok || end+19 > int64(locator.SizeBytes) {
		return nil
	}
	tail := readExact(handle, end, min(16*1024*1024, int64(locator.SizeBytes)-end))
	var found []*Archive
	for cursor, attempts := 0, 0; cursor < len(tail); {
		if ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		at := tail.indexOf(Magic, cursor)
		if at < 0 {
			break
		}
		attempts++
		require(attempts <= 32, "ARCHIVE_LIMIT")
		cursor = at + len(Magic)
		if archive := overlayCandidate(ctx, locator, end+int64(at)); archive != nil {
			found = append(found, overlayArchive(archive, locator))
		}
	}
	require(len(found) <= 1, "ARCHIVE_UNSUPPORTED")
	if len(found) == 0 {
		return nil
	}
	return found[0]
}

func overlayCandidate(ctx context.Context, locator *content.Locator, offset int64) *Archive {
	slice := &content.Locator{
		Path: locator.Path, Offset: locator.Offset + float64(offset),
		SizeBytes: locator.SizeBytes - float64(offset),
	}
	archive := readOrNil(ctx, slice, ReadOptions{IncludePlainEntries: true})
	if archive == nil || len(archive.Entries) == 0 || archive.Format != "" || archive.Unsupported != "" {
		return nil
	}
	return archive
}

func overlayArchive(archive *Archive, source *content.Locator) *Archive {
	names := map[string]bool{}
	result := archive.clone()
	result.SourceLocator, result.Omitted = source, nil
	for _, entry := range result.Entries {
		// Preserve output case while rejecting aliases in the engine's case-insensitive, slash-normalized namespace.
		name := strings.ReplaceAll(entry.Name, `\`, "/")
		key := normalizeName(name)
		require(safeName(name) && !names[key], "ARCHIVE_UNSUPPORTED")
		names[key] = true
		entry.Name, entry.H = name, entry.Adler
	}
	return result
}

func overlayStart(handle *content.Handle, size int64) (int64, bool) {
	pe := readPEHeaders(handle, size)
	if pe == nil {
		return 0, false
	}
	if kind := pe.headers.u16(0); kind != 0x10b && kind != 0x20b {
		return 0, false
	}
	headersEnd := pe.at + 24 + int64(len(pe.headers))
	end := headersEnd
	type span struct{ start, end int64 }
	var sections []span
	for index := range pe.count {
		start, length := pe.section(index)
		if length == 0 {
			continue
		}
		if start < headersEnd || length > size-start {
			return 0, false
		}
		for _, other := range sections {
			if start < other.end && other.start < start+length {
				return 0, false
			}
		}
		sections = append(sections, span{start, start + length})
		end = max(end, start+length)
	}
	return end, true
}
