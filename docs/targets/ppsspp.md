# PSP / PPSSPP

`ppsspp` accepts one `SEEKABLE_BLOB` and uses the maintained official-source
PPSSPP fork through `ppsspp-host-v4`. WebGL2, OffscreenCanvas, worker modules,
cross-origin isolation and SharedArrayBuffer are required. The core reads through shared [Content I/O](../content-io.md) bounded Range readers, memory caches and persistent block reuse. Fetch windows can coalesce or prefetch native reads; explicit full preload is a separate loading option. Responses must match the requested range, exact length and strong content
ETag. Local block checksums detect cache corruption; source identity comes from
the authorized immutable server, without a startup whole-ROM client hash scan.
In ordinary on-demand mode, cache failures retain bounded network reads and ignored ranges never trigger a whole-disc fallback. Explicit full preload requires successful persistent preparation. The adapter fully verifies executable core asset hashes.

Standard gamepad input, audio, pause, screenshots and native saves share the
Provider lifecycle. The Target declares `GAME_SAVE`: save through the game's own
menu or autosave, then synchronize the files already written. It cannot capture
the current execution state. On a new launch, use the game's Continue/Load menu.

`ppsspp-game-save-v1-storage-v1` contains all native slots and metadata under the
isolated instance's `PSP/SAVEDATA`, plus its virtual PSP MAC identity, under one
public gzip envelope with a 256 MiB limit. Native IO must finish before export;
unchanged content does not create another revision. Host persistence acknowledges
the exact exported content, so a later in-game save remains pending. A fresh game
without saved progress has no checkpoint. Deleting existing slots is synchronized
as a real filesystem change, including deletion of the final slot.

Files and virtual identity are restored before boot, without loading emulator
state. Only the current declared public format is accepted. [EmulatorJS PSP](emulatorjs-psp.md)
is an unbound Target with a different checkpoint contract.
PSP networking is disabled. ROMs and firmware are caller supplied.
