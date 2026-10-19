# SiglusEngine

## Content and language

The `siglus` platform/core/Target accepts an original directory containing `Scene.pck` and `Gameexe.dat` (or `Gameexe.ini`). The `language` option is explicit: configuration selects `chs` when both `scene.chs` and `gameexe.chs` exist at the selected root, otherwise `original`.

CHS overlays those resource pairs and matching `.g01` images without modifying source files. Patch DLLs are never executed. Games requiring other patch behavior need separate validation.

## Content loading and browser requirements

The Target supports `ON_DEMAND_AND_PRELOAD`, using the shared [Content I/O](../content-io.md) Range readers and persistent cache. Mounting the directory registers only paths and sizes. Native file reads request bounded ranges as needed; explicit full preload fills the same cache before startup.

The core's synchronous file API waits through WebAssembly JSPI (`Suspending` and `promising`), which the browser must support. The bridge implements no separate downloader or resource cache. Individual compressed files are still read whole by native decoders; embedded movie PCM has a 64 MiB cap. Movie video frames are decoded incrementally.

## Controls

Standard controls use the shared pointer cursor: directions and the left stick move it, A confirms through the left mouse button, and B uses the right mouse button.

## Saves

Checkpoint semantics are `GAME_SAVE`: save using the game's native menu, synchronize the complete save archive, import before a new instance starts, and load using the game's menu. Settings alone do not qualify as progress.

The adapter uses a fresh per-instance overlay; the public Host owns user isolation, persistence and one gzip layer. An acknowledgement applies only to the exported revision after persistence.

## Core distribution

The immutable `retrom-project/siglus_rs` core release is pinned by the `siglus` entry in [provider-sources.json](../../provider-sources.json), including its tag, commit and every asset's size and SHA-256. Complete dependency notices accompany the Provider. The core Release also provides the corresponding source and rebuild/relink inputs.
