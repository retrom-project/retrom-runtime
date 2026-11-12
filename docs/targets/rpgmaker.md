# RPG Maker projects

The product platform and core are both `rpgmaker`. The runtime selects a separate Target from the detected project engine; it does not launch every RPG Maker project with one implementation.

| Engine | Target | Runtime | Browser execution |
| --- | --- | --- | --- |
| 2000 / 2003 | `rpgmaker-2000`, `rpgmaker-2003` | EasyRPG | Same-origin frame |
| XP / VX / VX Ace | `rpgmaker-xp`, `rpgmaker-vx`, `rpgmaker-vx-ace` | mkxp | Threaded Wasm; cross-origin isolation required |
| MV / MZ | `rpgmaker-mv`, `rpgmaker-mz` | Project's native web engine | Isolated game origin and content bridge |

## Project preparation

Provide the complete project, retaining paths and engine assets. The runtime uses LCF identifiers, `Game.ini` script metadata or actual MV/MZ JavaScript markers to identify the engine. Multiple project roots or ambiguous engines require an explicit selection. A unique root `index.html` can select an MV/MZ project; the engine is not inferred from its display title.

EasyRPG receives a file-tree resource and optional RTP tree. mkxp receives a deterministic project ZIP exposed as a seekable resource, plus the engine's official RTP archive when Game.ini declares it (XP `Standard`, VX `RPGVX`, VX Ace `RPGVXAce`). The RTP is an installed runtime dependency: a ZIP holding the package's own directories at its root (not inside a `Standard/` folder), identified and verified by marker entries unique to that package, read by Range and mounted under the name the core looks up. Games without a declared RTP, MV/MZ and EasyRPG are unchanged. MV/MZ load their entry and ordinary relative scripts, imports, Workers and media through the isolated content bridge. Use the [runtime preparation result](../runtime-module.md) for these resources and requirements rather than constructing engine-specific host routes.

Desktop executables are not browser entry points. Supported ASAR/NW archive normalization extracts ordinary project files without executing native code. A project can still depend on unsupported desktop plugins or engine behavior; identifying its engine does not establish game compatibility.

## MV/MZ display

MV/MZ default to the engine's proportional stretch mode, including in desktop browsers. The game fits the available frame and follows window or fullscreen size changes, retaining its logical resolution and aspect ratio. Unused space remains as black bars. Canvas, video and pointer coordinates use the engine's own scale; the host does not need to resize the game's drawing buffer.

Viewport fitting is independent of browser fullscreen and the `original`, `pixel` and `smooth` image-rendering modes. It also applies before graphics initialization, or immediately if a plugin has already initialized the canvas. The engine's stretch toggle remains available.

## Loading and saves

All seven Targets support managed on-demand loading and explicit full preload. The loading mode changes resource acquisition, not project identity or the selected engine.

mkxp builds its path cache from ZIP central-directory metadata. It reads local file headers and content only as those files are opened, so listing a large project does not require fetching blocks throughout the archive. Embedded fonts can be selected by either their FreeType family names or localized SFNT aliases.

A terminating mkxp game exception or a native core abort (sandbox trap or forced assertion) emits `FATAL_ERROR` with code `RPG_RUNTIME_GAME_FAILED`, including the original exception or `Fatal error:` diagnostic when available. This stops play and native save export even when the game already presented opening frames.

All seven Targets declare `GAME_SAVE` semantics with the current `rpgmaker-game-save-v1-storage-v1` format. Save in the game's own menu or at its save points, then let the host synchronize the native data. The host never forces a new native slot or captures execution state. Restoring imports the complete native storage before the engine boots and starts the normal game flow; choose Continue / Load inside the game. Saving restrictions remain owned by the game.

EasyRPG transfers all files in its `Save` directory, including native `.lsd` slots and settings. mkxp transfers its native save-directory tree, including RGSS `.rxdata`, `.rvdata`, `.rvdata2` slots and shared files. MV/MZ transfer the isolated game's raw localStorage, MZ localForage strings, and MV's bounded desktop-plugin save files. Native string encoding is preserved. Only the Provider's public storage boundary applies transport gzip.

Exports are bounded, nonempty bundles. The host acknowledges exactly the export it durably persisted; later writes remain eligible for synchronization. A newly imported bundle starts as synchronized. Settings-only changes retain the previous progress screenshot. Game-owned exit includes unsynchronized native data when available. No native progress exists until the game creates it; the host's synchronization action does not bypass game save restrictions.

Restoring replaces the isolated run's native storage before boot, including removal of keys absent from the bundle when a preview restarts within the same run. Reloading without a restore descriptor retains that run's existing native browser storage.

MV's bounded desktop `fs` plugin surface and scenario preloading are described in [MV desktop plugins](rpgmaker-mv.md). This surface does not provide a general Node.js or NW.js environment.

Sources: [entry detection](../../src/runtime/configure.ts), [resource preparation](../../src/runtime/prepare.ts), and [Provider declarations](../../src/providers/retrom-runtime/catalog.ts).
