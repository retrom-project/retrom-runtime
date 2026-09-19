# Flash / Ruffle

`flash-ruffle` accepts one `game: ROM_BLOB` containing a standalone SWF (64 MiB maximum
compressed and declared uncompressed size). Companion assets, network services, projectors and
AIR packages are not supported by this Target. Script access, URL opening and movie networking
are disabled. Compatibility with a particular Flash API/game must be verified separately.

The fork ABI is `ruffle-host-v1`. Instance-owned SharedObject storage replaces localStorage;
the stable movie URL uses the content digest, not a Launch ID. `ruffle-sharedobjects-v1` is a
native `GAME_SAVE` envelope, not an instant execution snapshot: the game must actually write
SharedObjects before a changed payload can be exported. It allows 128 keys, 4 MiB native data
and an 8 MiB encoded envelope. Saves are installed before load and never implicitly restored.

Availability declares `save.dataKind: "STORAGE"`: these files are a persistent storage container,
possibly only settings or play counters, not guaranteed progress. Hosts update the selected container
on subsequent saves and create a fresh one only for a new game without an explicit restore.
Changed data remains exportable; no title-specific save or input exceptions are installed.
The stage is forced to `showAll` with centered alignment so game scripts cannot reset it to
an unscaled top-left surface; aspect-ratio letterboxing remains intentional.
The adapter declares internal `canvasLayout: "CORE"`: Ruffle alone sizes its responsive canvas
and DPI-scaled backing buffer. The Provider still fills the frame, but must not fit that changing
buffer as though it were a fixed-resolution game or overwrite the canvas offsets on resize/fullscreen.

Standard pad directions and left stick map to arrows; south maps to Space, east to Escape,
west to X and north/Start to Enter. Disconnect, pause and exit release held keys. Games needing
different or mouse-only controls still require per-game compatibility verification.

The provider pins the maintained fork release `retrom-core-ge46d1642fb67-r2` in `provider-sources.json`.
Runtime scripts consume its published assets and never compile the core. Local core changes require
an explicit fork build in the same PFB followed by `candidate:build`; overrides retain the closed
candidate inventory checks and are rejected by formal builds. Product acceptance belongs to the
Host's `ACC-FLASH-001`.
