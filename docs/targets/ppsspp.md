# PSP / PPSSPP

`ppsspp` accepts one `SEEKABLE_BLOB` and uses the maintained official-source
PPSSPP fork through `ppsspp-host-v2`. WebGL2, OffscreenCanvas, worker modules,
cross-origin isolation and SharedArrayBuffer are required. The core reads only
requested 256 KiB HTTP ranges, with bounded memory caches and persistent block
reuse. Responses must match the requested range, exact length and strong content
ETag. Local block checksums detect cache corruption; source identity comes from
the authorized immutable server, without a startup whole-ROM client hash scan.
Cache failures retain bounded network reads, and ignored ranges never trigger a
whole-disc fallback. The adapter fully verifies executable core asset hashes.

Standard gamepad input, audio, pause, screenshots and instant checkpoints share
the Provider lifecycle. `ppsspp-state-v1-storage-v1` contains complete execution
state and memory-stick files under one bounded gzip envelope, with a 256 MiB
limit. Pre-Range independent-core checkpoints remain readable; EmulatorJS PSP
checkpoint formats belong to a different target and are not accepted here.
PSP networking is disabled. ROMs and firmware are caller supplied.
