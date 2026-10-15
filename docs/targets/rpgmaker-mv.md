# RPG Maker MV desktop plugins

MV restores wait for the complete `Scene_Boot.start` call, including plugin wrappers, before installing temporary storage overrides or loading a checkpoint. Database readiness alone is insufficient: plugins can initialize global state in the boot hook. Restore timeout or page teardown fails the operation instead of entering an uninitialized map. MZ retains its existing readiness checks.

The native bridge supplies a limited `require('fs')` after game scripts load. It does not expose Node, `process`, other modules, host paths, or network URLs. Supported methods are `existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync`, and `unlinkSync`. Text encoding is UTF-8; unencoded reads return bytes with UTF-8 `toString()`.

The runtime resource plan includes these scenario scripts even when they sit beside `www/`, without including desktop executables or other sibling projects. Before starting MV, the adapter reads the project's `scenario/**/*.sl` and `scenario/**/*.txt` through managed Content I/O, in chunks of at most 256 KiB. The synchronous plugin read set is limited to 4,096 files and 16 MiB total. The project directory is the entry directory, or its parent when the entry is under `www/`. Images, audio, and other content retain demand loading. Scenario bytes remain immutable and use the existing Content I/O persistent cache; they are not copied into checkpoints.

Writes are restricted to direct `save/*.rpgsave` files, at most 128 files and 16 MiB total. `StorageManager.localFileDirectoryPath()` names this virtual directory without changing MV's browser storage mode. Shared plugin files are independent `FILESYSTEM` entries in the existing native save bundle. They are restored before `DataManager.loadGame` recreates game objects, and rolled back if restoration fails. Native slot and global-index entries retain their existing representation and format declaration.

Shared files belong to the selected Retrom checkpoint. Ordinary in-game slots share them during a run. Restoring an older Retrom checkpoint restores its shared files too; a new game does not inherit shared state from a different run. This does not implement an independent, always-latest achievement or unlock store.

Plugins may replace save metadata `title` with a map label. New metadata also records `runtimeGameTitle`; identity checks compare that value to the current game's title, then delegate to the original engine/plugin checks with a temporary identity view. The displayed map label and `globalId` validation remain intact. Metadata without this field continues through the engine's normal check. Host user/content identity checks are unchanged.

This is a bounded compatibility surface, not a general NW.js implementation. Unsupported modules, encodings, paths, and oversized file sets fail explicitly. No game scripts, source archives, database schema, or host API need changing.
