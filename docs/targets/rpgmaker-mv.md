# RPG Maker MV desktop plugins

MV/MZ use `GAME_SAVE`: native storage is imported before `SceneManager.run` begins engine boot. The bridge does not invoke `DataManager.saveGame`, invoke `DataManager.loadGame`, allocate a reserved save slot, change scenes, or clear plugin-specific caches. Plugins build their normal startup state from the imported native directory, and players load through the game itself.

The native bridge supplies a limited `require('fs')` after game scripts load. It does not expose Node, `process`, other modules, host paths, or network URLs. Supported methods are `existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync`, and `unlinkSync`. Text encoding is UTF-8; unencoded reads return bytes with UTF-8 `toString()`.

The runtime resource plan includes these scenario scripts even when they sit beside `www/`, without including desktop executables or other sibling projects. Before starting MV, the adapter reads the project's `scenario/**/*.sl` and `scenario/**/*.txt` through managed Content I/O, in chunks of at most 256 KiB. The synchronous plugin read set is limited to 4,096 files and 16 MiB total. The project directory is the entry directory, or its parent when the entry is under `www/`. Images, audio, and other content retain demand loading. Scenario bytes remain immutable and use the existing Content I/O persistent cache; they are not copied into checkpoints.

Writes are restricted to direct `save/*.rpgsave` files, at most 128 files and 16 MiB total. `StorageManager.localFileDirectoryPath()` names this virtual directory without changing MV's browser storage mode. Shared plugin files are independent `FILESYSTEM` entries in the native save bundle. They are imported with the browser storage before engine boot. Every ordinary native slot, global index, configuration value and supported shared file is included in a synchronization export.

Shared files belong to the selected Retrom native save bundle. Restoring an older bundle restores its shared files too; a new game does not inherit shared state from a different run. This does not implement an independent, always-latest achievement or unlock store. Save metadata and identity checks stay owned by the game's original engine and plugins.

This is a bounded compatibility surface, not a general NW.js implementation. Unsupported modules, encodings, paths, and oversized file sets fail explicitly. No game scripts, source archives, database schema, or host API need changing.
