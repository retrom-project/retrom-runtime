# GameMaker / Butterscotch

The `butterscotch` platform/core uses `retrom-runtime/butterscotch-gamemaker`. The current adapter accepts a project tree with exactly one root `data.win` and its companion assets. The index allows at most 10,000 nonempty files. A generic GameMaker marker found during configuration is not sufficient to run an incompatible export; the adapter validates its actual project layout.

The browser needs cross-origin isolation, SharedArrayBuffer, module Workers, OffscreenCanvas transfer and the storage-directory API. The native runner executes in a Worker. Standard gamepad state and the supported keyboard keys are forwarded to that runner; compatibility still depends on the game's controls and engine features.

## Loading

The project is registered as immutable file metadata. Native file reads use bounded shared Content I/O rather than downloading the complete project at mount. Full preload is an explicit option using the same persistent cache. The game reader and native-save overlay are separate; native-save storage can fall back to a session overlay when browser storage access fails.

## Saves

The Target declares `GAME_SAVE` with public format `butterscotch-game-save-v1-storage-v1`. Save within the game before exporting from the Host; after restoring, use the game's own load/continue menu. The VM, current room and controller state are not saved.

The Worker pauses at a frame boundary and flushes writes before exporting every regular file in the current session's save directory, including settings and nested files. The uncompressed bundle is limited to 16 MiB, 4,096 files and 32 directory levels. The Provider applies its common single gzip layer. A missing native file set reports `NO_SAVE`; storage export is distinct from creating a new in-game progress point. Exports keep their previous screenshot because the current screen does not identify the saved progress.

Restoration validates the complete file bundle before importing it into a fresh session directory, before game initialization can read it. Capturing files does not confirm persistence: only the Host's acknowledgement of the exact exported bytes marks them synchronized. New writes remain available after an older export is acknowledged. A core-owned exit carries any remaining native files through the common final-snapshot flow.

The runner can report `EXIT_REQUESTED`; after that event, the normal Provider shutdown and host persistence flow applies. Core release pins and the parser/runner asset closure are documented in [Maintaining upstream forks](../maintaining-forks.md#candidate-asset-closures).

Sources: [project validation and lazy readers](../../src/butterscotch/project-store.ts), [browser requirements and lifecycle](../../src/butterscotch/adapter.ts), and [Provider declaration](../../src/providers/retrom-runtime/catalog.ts).

The native-save core is currently a fixed upstream development input. Build its explicit PFB candidate for integration; a formal Provider build requires a published matching core release before promotion.
