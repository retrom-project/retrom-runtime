// Package content reads host-located game files within their exact logical byte ranges.
package content

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"syscall"

	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

// Locator places a logical file within a host file.
type Locator struct {
	Path      string  `json:"path"`
	Offset    float64 `json:"offset"`
	SizeBytes float64 `json:"sizeBytes"`
}

func safe(value float64) bool { return value == math.Trunc(value) && math.Abs(value) <= 1<<53-1 }

func (l *Locator) valid() bool {
	return l != nil && len(l.Path) > 0 && l.Path[0] == '/' && safe(l.Offset) && l.Offset >= 0 && safe(l.SizeBytes) &&
		l.SizeBytes >= 0 && safe(l.Offset+l.SizeBytes)
}

// Require returns the validated locator of file.
func Require(locators map[string]Locator, file *rules.File) (*Locator, error) {
	locator, exists := locators[file.LogicalKey]
	if !exists || !locator.valid() || locator.SizeBytes < 0 {
		return nil, rules.Fail("RUNTIME_CONTENT_LOCATOR_REQUIRED")
	}
	if locator.SizeBytes != file.SizeBytes {
		return nil, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	return &locator, nil
}

// Handle is an independent descriptor; positions and sizes belong to the logical file.
type Handle struct {
	file   *os.File
	offset int64
	size   int64
}

// Open opens a locator without following a final symlink.
func Open(locator *Locator) (*Handle, error) {
	if !locator.valid() {
		return nil, rules.Fail("RUNTIME_CONTENT_LOCATOR_REQUIRED")
	}
	file, err := os.OpenFile(locator.Path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, fmt.Errorf("open content: %w", err)
	}
	info, err := file.Stat()
	offset, size := int64(locator.Offset), int64(locator.SizeBytes)
	if err != nil || !info.Mode().IsRegular() || offset > info.Size() || size > info.Size()-offset {
		_ = file.Close()
		return nil, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	return &Handle{file: file, offset: offset, size: size}, nil
}

// Size is the logical file size.
func (h *Handle) Size() int64 { return h.size }

// ReadAt reads within the logical range; a short read at the end returns the bytes read.
func (h *Handle) ReadAt(buffer []byte, position int64) (int, error) {
	if position < 0 || position > h.size {
		return 0, rules.Fail("RUNTIME_CONTENT_RANGE_INVALID")
	}
	if remaining := h.size - position; int64(len(buffer)) > remaining {
		buffer = buffer[:remaining]
	}
	read, err := h.file.ReadAt(buffer, h.offset+position)
	if err != nil && !errors.Is(err, io.EOF) {
		return read, fmt.Errorf("read content: %w", err)
	}
	return read, nil
}

// ReadFull reads exactly len(buffer) bytes at position or reports a content change.
func (h *Handle) ReadFull(buffer []byte, position int64) error {
	read, err := h.ReadAt(buffer, position)
	if err != nil {
		return err
	}
	if read != len(buffer) {
		return rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	return nil
}

// Close releases the descriptor.
func (h *Handle) Close() error {
	if err := h.file.Close(); err != nil {
		return fmt.Errorf("close content: %w", err)
	}
	return nil
}

// Stream copies a logical range to writer in bounded chunks.
func Stream(ctx context.Context, locator *Locator, start, length int64, writer io.Writer) error {
	if !locator.valid() {
		return rules.Fail("RUNTIME_CONTENT_LOCATOR_REQUIRED")
	}
	size := int64(locator.SizeBytes)
	if start < 0 || length < 0 || start > size || length > size-start {
		return rules.Fail("RUNTIME_CONTENT_RANGE_INVALID")
	}
	handle, err := Open(locator)
	if err != nil {
		return err
	}
	defer func() { _ = handle.Close() }()
	buffer := make([]byte, 65536)
	for position := start; position < start+length; {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("content stream: %w", err)
		}
		chunk := buffer[:min(int64(len(buffer)), start+length-position)]
		read, err := handle.ReadAt(chunk, position)
		if err != nil {
			return err
		}
		if read == 0 {
			return rules.Fail("RUNTIME_CONTENT_CHANGED")
		}
		if _, err := writer.Write(chunk[:read]); err != nil {
			return fmt.Errorf("content stream: %w", err)
		}
		position += int64(read)
	}
	return nil
}

// limitedBuffer collects bytes up to a bound.
type limitedBuffer struct{ data []byte }

func (b *limitedBuffer) Write(data []byte) (int, error) {
	b.data = append(b.data, data...)
	return len(data), nil
}

// ReadPrefix reads the first length bytes of a logical file.
func ReadPrefix(ctx context.Context, locator *Locator, length int64) ([]byte, error) {
	buffer := &limitedBuffer{data: make([]byte, 0, length)}
	if err := Stream(ctx, locator, 0, length, buffer); err != nil {
		return nil, err
	}
	return buffer.data, nil
}

// ReadAll reads evidence of at most 32 MiB.
func ReadAll(ctx context.Context, locator *Locator) ([]byte, error) {
	if locator.SizeBytes > 32*1024*1024 {
		return nil, rules.Fail("RUNTIME_EVIDENCE_TOO_LARGE")
	}
	return ReadPrefix(ctx, locator, int64(locator.SizeBytes))
}

// ReadVerified reads a whole small file and checks its recorded size and SHA-256.
func ReadVerified(handle *Handle, file *rules.File) ([]byte, error) {
	if handle.Size() != file.Size() {
		return nil, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	data := make([]byte, file.Size())
	if err := handle.ReadFull(data, 0); err != nil {
		return nil, err
	}
	if SHA256(data) != file.SHA256 {
		return nil, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	return data, nil
}

// SHA256 returns the lowercase hex digest of data.
func SHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
