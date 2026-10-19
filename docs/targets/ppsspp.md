# PSP / PPSSPP

`ppsspp` accepts one `SEEKABLE_BLOB` and uses the maintained official-source
PPSSPP fork through `ppsspp-host-v2`. WebGL2, OffscreenCanvas, worker modules,
cross-origin isolation and SharedArrayBuffer are required. The core reads through shared [Content I/O](../content-io.md) bounded Range readers, memory caches and persistent block reuse. Fetch windows can coalesce or prefetch native reads; explicit full preload is a separate loading option. Responses must match the requested range, exact length and strong content
ETag. Local block checksums detect cache corruption; source identity comes from
the authorized immutable server, without a startup whole-ROM client hash scan.
In ordinary on-demand mode, cache failures retain bounded network reads and ignored ranges never trigger a whole-disc fallback. Explicit full preload requires successful persistent preparation. The adapter fully verifies executable core asset hashes.

Standard gamepad input, audio, pause, screenshots and instant checkpoints share
the Provider lifecycle. `ppsspp-state-v1-storage-v1` contains complete execution
state and memory-stick files under one bounded gzip envelope, with a 256 MiB
limit. Only the current declared public format is accepted. [EmulatorJS PSP](emulatorjs-psp.md) is an unbound Target with a different checkpoint contract; its state is not interchangeable with this product core.
PSP networking is disabled. ROMs and firmware are caller supplied.
