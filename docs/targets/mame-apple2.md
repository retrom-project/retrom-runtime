# MAME driver-family targets

The native `retrom-runtime` Provider uses `retrom-mame-dylink-v1`: a common JS/Wasm runtime plus the selected machine-family side module. Each instance has fresh machine memory; only verified immutable assets are reused. All modules must come from the same pinned native build.

## Computer and console machines

| Target | Native machine | Current input boundary |
| --- | --- | --- |
| `mame-apple2` | Apple II+ (`apple2p`) | One read-only 143,360-byte DOS-order DSK/DO disk |
| `mame-apple2e` | Apple IIe (`apple2e`) | One read-only 143,360-byte DOS-order DSK/DO disk |
| `mame-atom` | Acorn Atom (`atom`) | One ATM quickload file with a 22-byte header and matching nonempty payload within the 16-bit address space |
| `mame-pv1000` | Casio PV-1000 (`pv1000`) | One cartridge, at most 32 KiB |
| `mame-sg1000` | SG-1000 (`sg1000`) | One cartridge, at most 64 KiB in current native validation |
| `mame-coleco` | ColecoVision (`coleco`) | One cartridge, at most 32 KiB in current native validation |

These named machines do not imply support for other MAME computers, disk variants, expansions or multi-drive workflows. Atom selects its default RAM expansion with disk expansion disabled; BASIC software may still require an ordinary keyboard `RUN` command. The format-discovery catalog is broader than these adapter limits.

Firmware requirements and virtual paths come from runtime preparation and the selected [machine profile](../../src/mame/profiles.ts). Apple II+ and IIe have different system ROM sets, with their declared Disk II firmware. Atom requires its BASIC and floating-point ROMs; ColecoVision requires its declared 8 KiB BIOS. The PV-1000 and SG-1000 profiles have no external firmware resource.

These six machine Targets materialize game and required firmware before startup and do not declare Wasm threads. Standard gamepads and independent keyboard input use the selected machine's input profile; some software needs additional keys. Native display aspect ratio is preserved when fitting the frame and capturing screenshots.

## Arcade and CHD media

`mame_arcade` binds to the separate `mame-arcade` Target. It uses an explicit selected `machine`, requires Wasm threads and cross-origin isolation, and accepts paired DAT-driven ZIP/Parent/firmware resources plus declared CHD media. It is not restricted to the small media shapes in the table above. See [Arcade sets and MAME Current](arcade.md) for dependency discovery, bounded media reads and writable-media snapshot handling.

## Checkpoints and assets

All these MAME Targets declare `INSTANT` saves with public format `mame-state-v1-storage-v1` and a 64 MiB bound. The native container binds machine/content identity, native-build identity, length and SHA-256. The Provider adds one gzip layer. A native-build mismatch can reject restoration even when a public format name is unchanged; no cross-version MAME C++ state ABI is promised.

Core modules use shared [Content I/O](../content-io.md), including verified decoded core assets when HTTP compression is used. Game, firmware and Range resources retain their own content-encoding restrictions. Cache reuse does not remove native decompression, Wasm compilation or machine-memory costs.

The current immutable core release, metadata and complete side-module set are pinned in [provider-sources.json](../../provider-sources.json). Sources for these boundaries are the [Target declarations](../../src/providers/retrom-runtime/mame-declaration.ts), [machine/media validation](../../src/mame/profiles.ts), [state codec](../../src/mame/state.ts) and [arcade Worker state](../../src/mame/worker-state.ts).
