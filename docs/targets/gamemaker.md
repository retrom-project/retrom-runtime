# GameMaker / Butterscotch

The `butterscotch` platform/core uses `retrom-runtime/butterscotch-gamemaker`. The current adapter accepts a project tree with exactly one root `data.win` and its companion assets. The index allows at most 10,000 nonempty files. A generic GameMaker marker found during configuration is not sufficient to run an incompatible export; the adapter validates its actual project layout.

The browser needs cross-origin isolation, SharedArrayBuffer, module Workers, OffscreenCanvas transfer and the storage-directory API. The native runner executes in a Worker. Standard gamepad state and the supported keyboard keys are forwarded to that runner; compatibility still depends on the game's controls and engine features.

## Loading

The project is registered as immutable file metadata. Native file reads use bounded shared Content I/O rather than downloading the complete project at mount. Full preload is an explicit option using the same persistent cache. The game reader and native-save overlay are separate; native-save storage can fall back to a session overlay when browser storage access fails.

## Saves

The Target declares `INSTANT` with public format `butterscotch-checkpoint-v2-storage-v1`. Checkpoint availability distinguishes a temporarily busy state from native features that the core cannot serialize. Do not replace an unavailable execution checkpoint with a native file save or treat a title screen as evidence of restoration.

The runner can report `EXIT_REQUESTED`; after that event, the normal Provider shutdown and host persistence flow applies. Core release pins and the parser/runner asset closure are documented in [Maintaining upstream forks](../maintaining-forks.md#candidate-asset-closures).

Sources: [project validation and lazy readers](../../src/butterscotch/project-store.ts), [browser requirements and lifecycle](../../src/butterscotch/adapter.ts), and [Provider declaration](../../src/providers/retrom-runtime/catalog.ts).
