// Package retromruntime exposes the host-agnostic runtime facts shared by the TypeScript Provider build and the Go
// host.
package retromruntime

import "embed"

// Facts holds runtime-owned declaration data. Paths keep their repository layout.
//
//go:embed src/runtime/bindings.json src/runtime/platforms.json src/runtime/core-names.json
//go:embed src/runtime/content-formats.json src/runtime/bios-catalog.json src/runtime/arcade-provenance.json
//go:embed assets/facts/arcade-catalog.json.gz host/facts/declarations.json
var Facts embed.FS
