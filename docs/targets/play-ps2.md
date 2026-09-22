# Play! PS2

`retrom-runtime/play-ps2` consumes a single ISO or CHD as `SEEKABLE_BLOB` through the
fork-owned `play-host-v1` module. The core runs in a same-origin blank frame with WebGL2,
WebAssembly threads and cross-origin isolation. No BIOS upload is required. Multi-disc,
ELF boot, native settings, volume controls are not declared.

Disc access uses 256 KiB persistent cache blocks keyed by content identity, plus an 8 MiB
memory LRU. Missing or unavailable persistent storage falls back to bounded Range requests.
`play-state-v1` binds a native execution snapshot and both memory cards to the disc SHA-256;
its 256 MiB limit covers the entire payload. Standard gamepads support two ports; pause,
blur and exit release controls. Save/load must acknowledge native completion before resuming.

Play! is distributed through the normal pinned core release in `provider-sources.json`.
Ridge Racer V has observed vertical bobbing and missing 3D scenery, also reported in the
[upstream compatibility tracker](https://github.com/jpd002/Play-Compatibility/issues/349).
Host lifecycle and snapshot support do not imply complete compatibility for every PS2 game.
