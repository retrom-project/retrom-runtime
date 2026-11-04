// Package kirikiri converts protected KiriKiri XP3 resources to ordinary XP3 archives without executing native code.
package kirikiri

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

// Magic is the XP3 signature.
var Magic = []byte{0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01}

const (
	maximumIndex = 32 * 1024 * 1024
	maximumFile  = 8 * 1024 * 1024 * 1024
	// MaximumTree bounds a converted project.
	MaximumTree = 64 * 1024 * 1024 * 1024
	maxSafe     = 1<<53 - 1
)

// fail is a stable KiriKiri reason code.
func fail(code string) *rules.Failure { return rules.Fail("RUNTIME_KIRIKIRI_" + code) }

func require(value bool, code ...string) {
	if !value {
		name := "ARCHIVE_INVALID"
		if len(code) > 0 {
			name = code[0]
		}
		panic(fail(name))
	}
}

// errOutOfRange mirrors a JavaScript RangeError from an out-of-bounds typed read.
var errOutOfRange = errors.New("RANGE_ERROR")

// internalError is a non-reason failure (a JavaScript Error without a RUNTIME_ code); the normalization boundary
// reports it as RUNTIME_NORMALIZATION_FAILED.
type internalError struct{ message string }

func (e *internalError) Error() string { return e.message }

func internal(message string) *internalError { return &internalError{message} }

// view reads bytes with JavaScript Buffer semantics: an indexed byte outside the buffer is undefined (-1),
// while a multi-byte read outside it throws.
type view []byte

func (v view) at(index int) int {
	if index < 0 || index >= len(v) {
		return -1
	}
	return int(v[index])
}

// bit is a byte coerced as a JavaScript bitwise operand: undefined becomes 0.
func (v view) bit(index int) int {
	if index < 0 || index >= len(v) {
		return 0
	}
	return int(v[index])
}

func (v view) check(index, size int) {
	if index < 0 || index+size > len(v) {
		panic(errOutOfRange)
	}
}

func (v view) u16(index int) int {
	v.check(index, 2)
	return int(binary.LittleEndian.Uint16(v[index:]))
}

func (v view) u32(index int) uint32 {
	v.check(index, 4)
	return binary.LittleEndian.Uint32(v[index:])
}

func (v view) i8(index int) int {
	v.check(index, 1)
	return int(int8(v[index]))
}

func (v view) i32(index int) int {
	v.check(index, 4)
	return int(int32(binary.LittleEndian.Uint32(v[index:])))
}

func (v view) u32be(index int) uint32 {
	v.check(index, 4)
	return binary.BigEndian.Uint32(v[index:])
}

// indexOf mirrors Buffer.indexOf with a start offset.
func (v view) indexOf(pattern []byte, from int) int {
	if from < 0 {
		from = max(0, len(v)+from)
	}
	if from > len(v) {
		return -1
	}
	found := bytes.Index(v[from:], pattern)
	if found < 0 {
		return -1
	}
	return from + found
}

// sub mirrors Buffer.subarray with clamped bounds.
func (v view) sub(start, end int) view {
	start, end = max(0, min(start, len(v))), max(0, min(end, len(v)))
	if end < start {
		end = start
	}
	return v[start:end]
}

func (v view) ascii(start, end int) string {
	part := v.sub(start, end)
	builder := make([]rune, len(part))
	for index, value := range part {
		builder[index] = rune(value & 0x7f)
	}
	return string(builder)
}

func (v view) includes(pattern []byte) bool { return bytes.Contains(v, pattern) }

func (v view) includesByte(value int) bool { return value >= 0 && bytes.IndexByte(v, byte(value)) >= 0 }

func u32bytes(value uint32) []byte {
	result := make([]byte, 4)
	binary.LittleEndian.PutUint32(result, value)
	return result
}

func number64(data view, at int) int64 {
	require(at >= 0 && at+8 <= len(data))
	value := binary.LittleEndian.Uint64(data[at:])
	require(value <= maxSafe)
	return int64(value)
}

func uint64Bytes(value int64) []byte {
	result := make([]byte, 8)
	binary.LittleEndian.PutUint64(result, uint64(value))
	return result
}

func chunkBytes(tag string, data []byte) []byte {
	result := make([]byte, 0, 12+len(data))
	result = append(result, tag...)
	result = append(result, uint64Bytes(int64(len(data)))...)
	return append(result, data...)
}

type row struct {
	tag  string
	data view
}

func chunks(data view, onTag func(string)) []row {
	var result []row
	for at := 0; at < len(data); {
		if at+4 <= len(data) && onTag != nil {
			onTag(data.ascii(at, at+4))
		}
		require(at+12 <= len(data))
		length, start := number64(data, at+4), at+12
		require(length <= int64(len(data)-start))
		result = append(result, row{tag: data.ascii(at, at+4), data: data[start : start+int(length)]})
		at = start + int(length)
	}
	return result
}

// readExact reads size bytes at a logical position.
func readExact(handle *content.Handle, at, size int64) view {
	require(at >= 0 && size >= 0 && at <= handle.Size() && size <= handle.Size()-at && at <= maxSafe && size <= maxSafe)
	data := make([]byte, size)
	for filled := int64(0); filled < size; {
		read, err := handle.ReadAt(data[filled:], at+filled)
		require(err == nil && read > 0)
		filled += int64(read)
	}
	return data
}

// inflate decompresses a complete zlib stream of exactly size bytes.
func inflate(data []byte, size int64) view {
	require(size >= 0 && size <= maximumIndex && len(data) <= maximumIndex)
	reader := bytes.NewReader(data)
	decoder, err := zlib.NewReader(reader)
	require(err == nil)
	result, err := io.ReadAll(io.LimitReader(decoder, size+1))
	require(err == nil && int64(len(result)) == size && reader.Len() == 0)
	return result
}

func text16(data view, start, count int, empty bool) string {
	require((empty || count > 0) && count <= 32767 && start+count*2 <= len(data))
	end := start + count*2
	tail := data[end:]
	require(len(tail) == 0 || len(tail) == 2 && binary.LittleEndian.Uint16(tail) == 0)
	name, ok := textcodec.Decode(data[start:end], "utf-16le", true)
	require(ok && !strings.Contains(name, "\x00"))
	return name
}

var (
	slashes = regexp.MustCompile(`/+`)
	upper   = regexp.MustCompile(`[A-Z]`)
)

func normalizeName(name string) string {
	name = upper.ReplaceAllStringFunc(name, strings.ToLower)
	name = slashes.ReplaceAllString(strings.ReplaceAll(name, `\`, "/"), "/")
	return strings.TrimPrefix(name, "/")
}

func safeName(name string) bool {
	if name == "" || rules.UTF16Length(name) > 4096 || strings.ContainsAny(name, `:\`) || strings.HasPrefix(name, "/") {
		return false
	}
	for _, character := range name {
		if character < 32 || character == 127 {
			return false
		}
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func adler32(data []byte, previous uint32) uint32 {
	a, b := previous&65535, previous>>16
	for start := 0; start < len(data); start += 5552 {
		end := min(len(data), start+5552)
		for _, value := range data[start:end] {
			a += uint32(value)
			b += a
		}
		a %= 65521
		b %= 65521
	}
	return b<<16 | a
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// sourceHash streams the SHA-256 of a located file.
func sourceHash(ctx context.Context, locator *content.Locator) string {
	hash := sha256.New()
	err := content.Stream(ctx, locator, 0, int64(locator.SizeBytes), hash)
	if err != nil {
		panic(asFailure(err))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func asFailure(err error) error {
	var failure *rules.Failure
	if errors.As(err, &failure) {
		return failure
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return rules.Fail("RUNTIME_CANCELLED")
	}
	return fmt.Errorf("kirikiri io: %w", err)
}

// resourceBytes streams the decoded segments of an entry to visit.
func resourceBytes(ctx context.Context, locator *content.Locator, entry *Entry, visit func([]byte)) {
	for _, segment := range entry.Segments {
		reader := &segmentReader{ctx: ctx, locator: locator, position: segment.Offset, end: segment.Offset + segment.Packed}
		var source io.Reader = reader
		var counter *countingReader
		if segment.Mode != 0 {
			counter = &countingReader{reader: bufio.NewReader(reader)}
			decoder, err := zlib.NewReader(counter)
			if err != nil {
				panic(segmentFailure(ctx, err))
			}
			source = decoder
		}
		size := int64(0)
		buffer := make([]byte, 65536)
		for {
			read, err := source.Read(buffer)
			if read > 0 {
				if ctx.Err() != nil {
					panic(rules.Fail("RUNTIME_CANCELLED"))
				}
				size += int64(read)
				require(size <= segment.Expanded)
				visit(append([]byte(nil), buffer[:read]...))
			}
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				panic(segmentFailure(ctx, err))
			}
		}
		require(size == segment.Expanded && (counter == nil || counter.read == segment.Packed))
	}
}

func segmentFailure(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return rules.Fail("RUNTIME_CANCELLED")
	}
	var failure *rules.Failure
	if errors.As(err, &failure) && strings.HasPrefix(failure.Code, "RUNTIME_") {
		return failure
	}
	return fail("ARCHIVE_INVALID")
}

// countingReader is a flate.Reader, so the decoder consumes exactly what it counts.
type countingReader struct {
	reader *bufio.Reader
	read   int64
}

func (c *countingReader) Read(buffer []byte) (int, error) {
	read, err := c.reader.Read(buffer)
	c.read += int64(read)
	return read, streamError(err)
}

func (c *countingReader) ReadByte() (byte, error) {
	value, err := c.reader.ReadByte()
	if err == nil {
		c.read++
	}
	return value, streamError(err)
}

// streamError keeps the io.Reader end-of-stream sentinel identical and labels any other failure.
func streamError(err error) error {
	if err == nil || errors.Is(err, io.EOF) {
		return err
	}
	return fmt.Errorf("archive stream: %w", err)
}

// segmentReader reads one stored segment range in 64 KiB chunks.
type segmentReader struct {
	ctx      context.Context
	locator  *content.Locator
	handle   *content.Handle
	position int64
	end      int64
}

func (r *segmentReader) Read(buffer []byte) (int, error) {
	if r.position >= r.end {
		if r.handle != nil {
			_ = r.handle.Close()
			r.handle = nil
		}
		return 0, io.EOF
	}
	if r.handle == nil {
		size := int64(r.locator.SizeBytes)
		if r.position < 0 || r.end > size {
			return 0, rules.Fail("RUNTIME_CONTENT_RANGE_INVALID")
		}
		handle, err := content.Open(r.locator)
		if err != nil {
			return 0, fmt.Errorf("open segment: %w", err)
		}
		r.handle = handle
	}
	if err := r.ctx.Err(); err != nil {
		return 0, rules.Fail("RUNTIME_CANCELLED")
	}
	chunk := buffer[:min(int64(len(buffer)), r.end-r.position, 65536)]
	read, err := r.handle.ReadAt(chunk, r.position)
	if err != nil {
		return read, fmt.Errorf("read segment: %w", err)
	}
	if read == 0 {
		return 0, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	r.position += int64(read)
	return read, nil
}

// readAll collects an entry's decoded bytes.
func readAll(ctx context.Context, locator *content.Locator, entry *Entry) []byte {
	var result []byte
	resourceBytes(ctx, locator, entry, func(data []byte) { result = append(result, data...) })
	return result
}
