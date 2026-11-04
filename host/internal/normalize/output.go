package normalize

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/pipeline"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

var (
	// errRange mirrors a JavaScript RangeError from an out-of-bounds typed read.
	errRange = errors.New("RANGE_ERROR")
	errEOF   = io.EOF
	// errValueType reports a plugin value of an unexpected type, which is a programming defect.
	errValueType = errors.New("normalization value type mismatch")
)

// as returns a plugin-owned value of its known type; a mismatch raises a generic normalization failure.
func as[T any](value any) T {
	typed, ok := value.(T)
	if !ok {
		panic(errValueType)
	}
	return typed
}

// recoverFailure converts format panics to errors at a plugin boundary.
func recoverFailure(err *error) {
	recovered := recover()
	if recovered == nil {
		return
	}
	switch value := recovered.(type) {
	case *rules.Failure:
		*err = value
	case error:
		*err = value
	default:
		panic(recovered)
	}
}

func verifySource(ctx context.Context, locator *content.Locator, expected string) {
	hash := sha256.New()
	if err := content.Stream(ctx, locator, 0, int64(locator.SizeBytes), hash); err != nil {
		panic(err)
	}
	if hex.EncodeToString(hash.Sum(nil)) != expected {
		panic(rules.Fail("RUNTIME_CONTENT_CHANGED"))
	}
}

// locatedReader streams a whole located file.
type locatedReader struct {
	ctx      context.Context
	locator  *content.Locator
	handle   *content.Handle
	position int64
}

func (r *locatedReader) Read(buffer []byte) (int, error) {
	if r.handle == nil {
		handle, err := content.Open(r.locator)
		if err != nil {
			return 0, fmt.Errorf("open content: %w", err)
		}
		r.handle = handle
	}
	if r.position >= int64(r.locator.SizeBytes) {
		_ = r.handle.Close()
		return 0, io.EOF
	}
	if r.ctx.Err() != nil {
		return 0, rules.Fail("RUNTIME_CANCELLED")
	}
	chunk := buffer[:min(int64(len(buffer)), int64(r.locator.SizeBytes)-r.position, 65536)]
	read, err := r.handle.ReadAt(chunk, r.position)
	if err != nil {
		return read, fmt.Errorf("read content: %w", err)
	}
	if read == 0 {
		return 0, rules.Fail("RUNTIME_CONTENT_CHANGED")
	}
	r.position += int64(read)
	return read, nil
}

const maximumOutput = 8 * 1024 * 1024 * 1024

// writeDestination writes only a declared output in this request's private phase directory.
func writeDestination(input *pipeline.Context, logicalKey string, source io.Reader) pipeline.OutputFile {
	if !rules.SafePath(logicalKey) {
		panic(rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID"))
	}
	path := filepath.Join(input.OutputRoot, logicalKey)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		panic(rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID"))
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		panic(rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID"))
	}
	hash := sha256.New()
	length := int64(0)
	buffer := make([]byte, 65536)
	failed := true
	defer func() {
		_ = file.Close()
		if failed {
			_ = os.Remove(path)
		}
	}()
	for {
		if input.Ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		read, err := source.Read(buffer)
		if read > 0 {
			hash.Write(buffer[:read])
			length += int64(read)
			if length > maximumOutput {
				panic(rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID"))
			}
			if _, writeErr := file.Write(buffer[:read]); writeErr != nil {
				panic(rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID"))
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			panic(err)
		}
	}
	if err := file.Sync(); err != nil {
		panic(rules.Fail("RUNTIME_NORMALIZATION_OUTPUT_INVALID"))
	}
	failed = false
	return pipeline.OutputFile{File: rules.File{
		LogicalKey: logicalKey, Name: logicalKey, SizeBytes: float64(length),
		SHA256: hex.EncodeToString(hash.Sum(nil)),
	}, Path: path}
}
