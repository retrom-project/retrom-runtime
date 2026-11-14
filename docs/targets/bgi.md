# BGI / Ethornell

The `bgi` platform uses the `ethornell` core and `retrom-runtime/bgi` Target.
Import a Windows game directory or ZIP containing `system.arc` and its original
resource archives. The runtime recognizes the project root without using game
names. Keep accompanying loose resources, fonts and executable files: the core
can read engine configuration from them but never executes Windows programs or DLLs.
Android APK/OBB packages are not this Target's input format.

## Content and browser

The Target supports `ON_DEMAND_AND_PRELOAD` through shared Content I/O Range
readers and persistent caching. Mounting lists files without reading whole archives.
Explicit preload fills the same cache in bounded chunks, reports progress and holds
its lease until exit. A new launch reuses content identity across changing URLs.
The worker transport only forwards reads; it owns no separate downloader or cache.

Chrome must provide cross-origin isolation, SharedArrayBuffer, OffscreenCanvas,
WebGL2, module workers and AudioWorklet. Core modules, Wasm and the default OFL
font are verified Provider assets. `textEncoding` explicitly selects `cp932`
(default) or `gbk`; translated resource packages require separate compatibility
verification. SWF bitmaps and movie codec coverage retain upstream limitations.

## Input and saves

Keyboard and pointer controls follow the original engine. Standard gamepad directions
and the left stick move the shared pointer; A clicks the left button and B the right.
Pause and exit release held controls.

Save semantics are `GAME_SAVE`: save progress in the game's menu, synchronize the
native files, then load from the game's menu after restoring into a new launch.
Native `BGI####.cad` and numbered `*.sud` progress slots enable capture; settings
alone do not. The worker has a fresh user overlay per launch,
restores before interpreter initialization, and only acknowledges the exact revision
successfully persisted by the host. The runtime validates bounded nonempty save
files and applies one public gzip layer.

Source, builds and dependency notices belong to the maintained
[`retrom-project/ethornell-rs`](https://github.com/retrom-project/ethornell-rs) fork.
Development candidates remain separate from immutable release pins. A catalog entry
does not promise compatibility with every BGI game or patch.
