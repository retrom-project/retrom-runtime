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

## Loading and saves

All seven Targets support managed on-demand loading and explicit full preload. The loading mode changes resource acquisition, not project identity or the selected engine.

All seven currently declare `INSTANT` checkpoint semantics. EasyRPG uses its engine save bundle, mkxp captures native execution state, and MV/MZ capture through their native bridge. Follow current checkpoint availability and the Target's public format; a bundle backed by native files must still satisfy the declared execution-restoration behavior. In-game save slots are separate from host checkpoint selection.

MV's bounded desktop `fs` plugin surface and scenario preloading are described in [MV desktop plugins](rpgmaker-mv.md). This surface does not provide a general Node.js or NW.js environment.

Sources: [entry detection](../../src/runtime/configure.ts), [resource preparation](../../src/runtime/prepare.ts), and [Provider declarations](../../src/providers/retrom-runtime/catalog.ts).
