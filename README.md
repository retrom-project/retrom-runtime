# retrom-runtime

`retrom-runtime` is a host-independent browser library and release bundle for RPG Maker 2000, 2003, XP,
VX, VX Ace, MV and MZ, ONS games powered by ONScripterYuri, KAG-based KiriKiri2 games and supported GameMaker
projects powered by Butterscotch. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core
Release inputs. It does not know about a host application's users, database, review flow, storage or HTTP API.

## Public API

```ts
import { createRuntime, type RuntimeConfig } from "@xxxsen/retrom-runtime";

const config: RuntimeConfig = launchConfig;
const runtime = createRuntime(config, {
  frame,
  frameWindow,
  restorePayload,
  onDiagnostic: ({ runtime, message }) => console.info(`[${runtime}] ${message}`),
});
await runtime.mount(container);
```

The host supplies URLs, an isolated frame where required, an optional restore payload and an explicit adapter
configuration. The library never calls a host review, upload, save-state or authentication endpoint.
For EasyRPG, `adapter.projectRootUrl` is passed to the core as the complete
project directory URL; neither the adapter nor the core assumes a host route.

Every adapter uses the same engine-neutral `GameRuntime` lifecycle. Capabilities and checkpoint formats are
declared in `runtime-manifest.json`; hosts do not infer them from a generation name. Core-specific validation is
an extension probe. RPG Maker exposes `rpgmaker.position.v1`, while ONS and KiriKiri do not fabricate map IDs or
player coordinates.

Content sources are also host-independent. Directory-oriented adapters consume
`FILE_TREE_V1`; mkxp consumes `SEEKABLE_BLOB_V1`; native Web projects retain
their isolated entry model. A seekable blob supplies a URL, size, diagnostic
digest and `rangeRequired: true`. The mkxp adapter registers that URL in
WasmFS and passes only a virtual path to the core—it does not turn the project
or RTP archives into JavaScript `Blob`s or download them before the first
frame. Its pinned fork rejects a missing Range contract, a non-206 response,
an inexact `Content-Range`, and response-length drift instead of silently
falling back to a whole-file request. Core JS/Wasm and bridge assets still use
full-byte validation, while their immutable URLs use the browser cache.

EasyRPG receives both the project and optional RTP as `FILE_TREE_V1` roots. The project wins when it contains a
resource; only a missing resource that the game actually opens is fetched from the RTP root. ONS keeps ordinary
scripts and images on the same file-on-first-open path. Exact-size immutable responses are streamed into the
Emscripten file system and an origin-private file one at a time, so concurrent multi-hundred-megabyte writes cannot
evict or drop one another and archives larger than Chromium's ordinary HTTP or Cache Storage entry limits are still
reused by a later runtime instance. Cache Storage is only the fallback when OPFS is unavailable. Aggregate project
bytes are reported through `LOAD_PROGRESS`; persistent storage being unavailable or full falls back to the normal fetch without
blocking the game. Large videos are handed to the browser media pipeline by URL so it can issue Range requests
instead of copying the complete movie into the Emscripten file system. KiriKiri keeps its 256 KiB-block VLFS Range
reader and refuses a large response that ignores a requested range rather than silently buffering the whole file.

Native RPG Maker MV/MZ checkpoints use the engine's `DataManager` and a temporary private storage slot. The bridge
also executes the standard `$gameSystem.onBeforeSave()` and `onAfterLoad()` hooks at the same lifecycle boundaries
as the engine save/load scenes. This preserves engine- and plugin-owned resume state such as the current BGM/BGS
without inventing host-specific playback behavior. EasyRPG, mkxp, ONS and KiriKiri restore through their core state
or native save APIs and do not use these RPG Maker Web hooks.

Butterscotch is an independent GameMaker runtime. Its host config points to an exact project index containing one
root `data.win`. Files stream into an OPFS directory keyed by the host content digest, so later runtime instances
reuse exact-sized bytes without another network transfer. The adapter renders on a centered 640×480
`OffscreenCanvas`, forwards keyboard and standard gamepad state, emits load progress, captures bounded direct
checkpoints, restores them in a new Worker instance and reports a core-initiated exit through the common lifecycle.
The first compatibility line is intentionally limited to GameMaker data versions accepted by the pinned
Butterscotch core and to runtime states its checkpoint status reports as supported.

ONS is a separate public runtime rather than an RPG Maker generation:

```ts
import { createRuntime, type OnsRuntimeConfig } from "@xxxsen/retrom-runtime";

const runtime = createRuntime(config, { frameWindow, restorePayload });
await runtime.mount(container);
const checkpoint = await runtime.checkpoint();
```

An ONS project index has the stable shape below. Paths are project-relative and URLs remain supplied by the host:

```json
{
  "schemaVersion": 1,
  "title": "Example",
  "fontPath": "default.ttf",
  "files": [{ "path": "0.txt", "url": "https://content.example/0.txt" }]
}
```

Hosts can subscribe before `mount()` to render first-load progress. A later instance still emits progress while
reading persisted bytes into the core, but it does not transfer a cached project file over the network:

```ts
runtime.subscribe((event) => {
  if (event.type === "LOAD_PROGRESS" && event.phase === "PROJECT_CONTENT") {
    renderProgress(event.loadedBytes, event.totalBytes);
  }
});
```

Each session must use its own frame. `exit()` pauses the core and removes library-owned DOM and globals; the host
then discards that frame to release Emscripten's document-level input hooks.

Games may also terminate through their own title/menu UI. Every adapter translates that engine/process boundary
into one `EXIT_REQUESTED` event. The shared controller immediately leaves the running state, makes checkpoint
capture unavailable and releases the adapter. A host should subscribe before `mount()`, finish its play session
and leave or close the Player when it receives this event; it must not keep a black canvas or offer saving after
the core has ended.

KiriKiri is also an independent runtime:

```ts
import { createRuntime, type KirikiriRuntimeConfig } from "@xxxsen/retrom-runtime";

const runtime = createRuntime(config, { frameWindow, restorePayload });
await runtime.mount(container);
const checkpoint = await runtime.checkpoint();
```

The first compatibility line is deliberately limited to games exposing the standard KAG
`saveBookMark`/`loadBookMark` API. Its checkpoint contains the small native KAG save files written under
`/savedata` or `/save`; it is not a raw Wasm memory snapshot. A pure TJS/custom-engine title without these KAG
methods fails closed as unsupported instead of producing a checkpoint that cannot be restored. The host supplies
a project file index and, only when that project contains multiple XP3 archives, the explicit project-relative XP3
entry selected during import. Runtime slot `1999` is outside the normal KAG save menu. The adapter keeps the core
running until the successful slot request causes a non-bookkeeping save write, then captures the complete quiescent save-file
set. This also supports KAG games that override the default `data1999.ksd` filename while retaining the standard
bookmark API. If the host paused the runtime before asking for a checkpoint, the adapter resumes it before waiting
for the next stable KAG save point and restores the paused state after capture.

The KiriKiri Web core does not expose its native pad-key conversion in Emscripten builds. The adapter therefore
provides a visible virtual pointer: a standard gamepad's D-pad and left stick move it, A performs a left click and
B performs a right-click cancel. Runtime cleanup releases every held button. The same runtime path is used by host
review previews and product players.

ONScripterYuri receives its native standard-gamepad D-pad and face-button events through SDL. The adapter adds
only the missing standard left-stick direction mapping, with dead-zone hysteresis and complete key release on
exit. It also creates the core's WebGL context with a retained drawing buffer so host-requested review and save
screenshots contain the displayed frame instead of a cleared black buffer.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
```

Runtime JS/Wasm is not committed or built here. EasyRPG, mkxp, ONScripterYuri, KiriKiri and Butterscotch are maintained in
separate forks; each fork owns its source changes, quality checks, Web build and immutable core Release. This
repository downloads those fixed releases, adds its own small bridge assets and produces:

- `release/retrom-runtime-<version>.tar.gz`
- `release/xxxsen-retrom-runtime-<version>.tgz` (installable npm package)
- `release/retrom-runtime-release.json`

The repository keeps one current asset for each runtime role and never creates parallel versioned asset
directories. The `retrom-runtime` Git tag versions the complete set; older sets remain available only from their
immutable release tags.

Adapter IDs and asset paths describe roles, not migration revisions. Version selection happens only at the
repository release tag; the source tree and each release contain one implementation per runtime role.
SHA-256 values in release metadata detect corrupt downloads; compatibility identity is the immutable
`retrom-runtime` tag and each upstream repository plus its tag, when one exists, and exact commit.

Core changes can be integrated before a formal fork Release. Build and validate the candidate in the fork, then
point `RETROM_RUNTIME_DEV_RELEASE_OVERRIDES` at the absolute output directory while running `release:build`:

```bash
RETROM_RUNTIME_DEV_RELEASE_OVERRIDES='{"onsyuri":"/work/OnscripterYuri/output"}' npm run release:build
```

Use key `kirikiri2` for the KiriKiri fork and `butterscotch` for the Butterscotch fork. The same environment is inherited by Retrom's
`RETROM_RUNTIME_DEV_ROOT`/`RETROM_RUNTIME_DEV_INCLUDE_ASSETS=true` local-link flow. This affects only ignored local
staging output; the committed manifest and formal Release inputs remain pinned to published fork tags.

Each core also declares three forward-upgrade fields in `runtime-manifest.json`:

- `gameCompatibilityLine` is the stable logical game-input contract. A release must keep the same line for an
  existing core; an incompatible game loader is a new core rather than an in-place upgrade.
- `saveAbi` is the checkpoint format written by the release.
- `readableSaveAbis` is the exact, non-empty set the release can restore and always includes `saveAbi`.

Hosts should resolve an imported game through its logical core to the current release. A checkpoint whose
`saveAbi` is absent from the current core's `readableSaveAbis` remains visible but must not be loaded. Releases
are fixed forward; this repository does not require hosts to retain or roll back to an older runtime bundle.

The mkxp core still serializes into its fixed 256 MiB memory buffer. The adapter does not upload that zero-padded
buffer directly: it trims the unused zero tail in bounded asynchronous chunks, compresses the meaningful prefix in a worker and stores a compact
`mkxp-state-compact` checkpoint. Restore expands the checkpoint back to the exact 256 MiB core buffer before the
private load hotkey is sent. This is an aggregate-runtime ABI; the pinned upstream core Release continues to expose
its raw serializer ABI and does not need a host-specific patch for compression.

## Adding and integrating a core

1. Put third-party source changes and the Web build in a dedicated maintained fork; produce one fixed candidate asset set.
2. Add the runtime entry and adapter implementation without aliases or fallback implementations.
3. Add adapter unit tests and a small owned or redistributable compatibility fixture. Private operator games may
   be used for an ignored local smoke but never enter Git or ordinary automated tests.
4. Open a PR to `master`; the quality workflow runs lint, types, unit tests and the package build without compiling cores.
5. Use local fork-asset overrides for the host's real import/launch/save/restore product test.
6. Publish the stable fork tag, pin it here, then publish the aggregate runtime tag.

This keeps core development independent: a new core can be tested without replacing the stable runtime used by
other games or requiring unrelated host changes.

## Maintaining upstream forks

The Player `master`, mkxp-z Web `main`, ONScripterYuri `master`, KiriKiri Web `web`, and Butterscotch `main`
branches are unmodified, fast-forward-only upstream mirrors. Retrom changes live on one active
`retrom/<baseline>` branch per fork, which is also that fork's default branch.
Each fork records its exact tagged or commit-only upstream baseline in a root
`retrom-fork.json`. Work starts from the active baseline on short-lived
`fix/*`, `feat/*`, `build/*`, or `sync/upstream-*` branches and is merged back
before a release tag is created. A moving upstream mirror is never merged into
a fixed release baseline.

Fork releases use only `rpg-runtime-<upstream-baseline>-rN` tags. For a new
upstream without a tag, the baseline token is `g` plus 12 hexadecimal commit
characters; the release metadata still records the full commit. Tags and
assets are immutable, and aliases such as `latest`, `stable`, and the retired
`retrom-web-*` namespace are not supported. This aggregate repository pins the
fork repository, stable tag, tag commit, filenames, and adapter ABI.
