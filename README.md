# retrom-runtime

`retrom-runtime` is a host-independent browser library and release bundle for RPG Maker 2000, 2003, XP,
VX, VX Ace, MV and MZ, ONS games powered by ONScripterYuri, KAG-based KiriKiri2 games, supported GameMaker
projects powered by Butterscotch, browser TyranoScript projects and WASM-4 carts. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core
Release inputs. It does not know about a host application's users, database, review flow, storage or HTTP API.

## Provider Module V1

Hosts integrate the generated Provider Bundle, not an engine registry or the legacy adapter API. A Bundle exports
one `client.mjs` with this closed interface:

```ts
export const providerId = "retrom-runtime";
export const providerVersion = "0.14.5";
export const providerApiVersion = 1;
export function validateLaunchRequest(value: unknown): LaunchEnvelopeV1;
export async function createRuntime(
  value: unknown,
  host: RuntimeHostV1,
): Promise<PlayerRuntimeV1>;
```

The host validates a Launch Envelope V1, verifies the module URL and SHA-256 against the active Bundle, imports
the module, checks the exported identity and calls `createRuntime`. It only consumes `PlayerRuntimeV1`; it never
chooses EasyRPG, mkxp, native Web or another implementation. The Provider validates the stable `providerId` plus
`targetId`, current resources, private Target options, optional restore, validation and netplay inputs before mounting.

`src/providers/retrom-runtime/catalog.ts` is the single Target declaration for the 12 targets in this Provider.
The generated declaration provides current capabilities, checkpoint `writeFormat/readFormats/maxBytes`, resource
kinds, runtime files and a constrained closed `targetOptionsSchema`. The Provider Module uses that schema to
exact-validate options before mounting; it has no
`optionsKind` discriminator. A Host dispatcher only needs generic JSON safety, depth and size limits and must not
copy these Target-specific properties. `provider-sources.json` records only pinned upstream Release/build sources;
it cannot declare a Target or host binding. Core-specific validation remains an extension probe: RPG Maker exposes
`rpgmaker.position.v1`, while ONS and KiriKiri do not fabricate map IDs or player coordinates.

The older package-level runtime constructors remain internal implementation building blocks for this Provider.
New hosts must use Provider Module V1 and must not build a parallel adapter registry from those exports.

Content sources are also host-independent. Directory-oriented adapters consume
`FILE_TREE`; mkxp consumes `SEEKABLE_BLOB`; native Web projects retain
their isolated entry model. A seekable blob supplies a URL, size, diagnostic
digest and `rangeRequired: true`. The mkxp adapter registers that URL in
WasmFS and passes only a virtual path to the core—it does not turn the project
or RTP archives into JavaScript `Blob`s or download them before the first
frame. Its pinned fork rejects a missing Range contract, a non-206 response,
an inexact `Content-Range`, and response-length drift instead of silently
falling back to a whole-file request. Core JS/Wasm and bridge assets still use
full-byte validation, while their immutable URLs use the browser cache.

EasyRPG receives both the project and optional RTP as `FILE_TREE` roots. The project wins when it contains a
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
The Target accepts only GameMaker data versions supported by the pinned Butterscotch core and runtime states its
checkpoint status reports as supported.

TyranoScript projects use the engine already present in the imported game and run in a per-Launch isolated origin.
The host injects the small, independently licensed bridge aggregated from the maintained fork; the aggregate runtime
does not redistribute TyranoScript itself. The adapter connects over a strict `MessageChannel`, delegates standard
gamepad input to TyranoScript's browser input layer, captures a bounded semantic snapshot without a thumbnail and
restores it in a fresh frame without opening the game's load menu. Restore uses TyranoScript's normal load lifecycle,
including its current BGM replay, and waits for `load-complete` before reporting ready. A game `[close]` command is
translated into the common `EXIT_REQUESTED` event instead of leaving the host on a closed or black frame.

WASM-4 consumes one content-addressed cart of at most 64 KiB and verifies its exact byte length and SHA-256 before
starting the core. The maintained fork exposes a host-independent Web module with keyboard and standard-gamepad
input, screenshots, bounded `wasm4-state-v1` checkpoints and direct restore in a fresh instance. Checkpoints bind
WASM memory, exported mutable globals and the bounded WASM-4 disk to the exact cart digest.

ONS is a separate Provider Target rather than an RPG Maker generation. A Host launches target
`onscripter-yuri` through Provider Module V1 and only interacts with the returned `PlayerRuntimeV1`;
the ONS adapter config and constructor are private implementation details of the Provider.

An ONS project index has the stable shape below. Paths are project-relative and URLs remain supplied by the host:

```json
{
  "schemaVersion": 1,
  "title": "Example",
  "fontPath": "default.ttf",
  "files": [{ "path": "0.txt", "url": "https://content.example/0.txt" }]
}
```

Hosts can subscribe to the Provider-returned runtime before `mount()` to render first-load progress. A later
instance still emits progress while
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

KiriKiri is also an independent Provider Target. A Host launches target `kirikiri2-kag` through
Provider Module V1 and never imports the KiriKiri adapter config or constructor.

The KiriKiri Target accepts games exposing the standard KAG `saveBookMark`/`loadBookMark` API. Its checkpoint
contains the small native KAG save files written under
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
npm run provider:input:check
npm run provider:build
npm run provider:check
npm run release:build
```

Runtime JS/Wasm is not committed or built here. EasyRPG, mkxp, ONScripterYuri, KiriKiri, Butterscotch, WASM-4 and
the TyranoScript host bridge are maintained in
separate forks; each fork owns its source changes, quality checks, Web build and immutable core Release. This
repository downloads those fixed releases, adds its own small bridge assets and produces two Provider Bundle V1
archives (`emulatorjs` and `retrom-runtime`), their descriptors/integrity records, an installable npm package and
release metadata. Every archive has a closed file allowlist, deterministic metadata, licenses, provenance,
an immutable Bundle digest and a `client.mjs` digest. Two builds from identical input must produce identical bytes.

PFB candidate integration uses a spec generated by Retrom. The spec points at this checkout and optional core
worktrees, with commit and source-tree digests. `candidate:build -- --spec ... --output ...` may override only a
source already declared in `provider-sources.json`; it cannot inject a Target. Candidate output is rejected by
formal package/release commands and never modifies production locks.

`providerId` plus `targetId` is the permanent Target identity. Provider upgrades switch the active Bundle without
rewriting games, reviews or saves. Each Target declares the checkpoint format written by the current Provider and
the exact non-empty `readFormats` set it can restore; `readFormats` includes `writeFormat`. A checkpoint whose format
is absent from the current Target's `readFormats` remains visible but cannot be loaded. Hosts only upgrade and never
retain, restore or fall back to an older Bundle.

The mkxp core still serializes into its fixed 256 MiB memory buffer. The adapter does not upload that zero-padded
buffer directly: it trims the unused zero tail in bounded asynchronous chunks, compresses the meaningful prefix in a worker and stores a compact
`mkxp-state-compact` checkpoint. Restore expands the checkpoint back to the exact 256 MiB core buffer before the
private load hotkey is sent. This is an aggregate-runtime ABI; the pinned upstream core Release continues to expose
its raw serializer ABI and does not need a host-specific patch for compression.

## Adding and integrating a core

1. Put third-party source changes and the Web build in a dedicated maintained fork; produce one fixed candidate asset set.
2. Add one Target to the Provider declaration and its private implementation without aliases or fallback implementations.
3. Add adapter unit tests and a small owned or redistributable compatibility fixture. Private operator games may
   be used for an ignored local smoke but never enter Git or ordinary automated tests.
4. Open a PR to `master`; the quality workflow runs lint, types, unit tests and the package build without compiling cores.
5. Use a PFB candidate descriptor for the host's real import/launch/checkpoint/restore product test.
6. Publish the stable fork tag, pin it here, then publish the aggregate runtime tag.

This keeps core development independent: a new core can be tested without replacing the stable runtime used by
other games or requiring unrelated host changes.

## Maintaining upstream forks

The Player `master`, mkxp-z Web `main`, ONScripterYuri `master`, KiriKiri Web `web`, Butterscotch `main`,
TyranoScript `master` and WASM-4 `main`
branches are unmodified, fast-forward-only upstream mirrors. Retrom changes live on one active
`retrom/<baseline>` branch per fork, which is also that fork's default branch.
Each fork records its exact tagged or commit-only upstream baseline in a root
`retrom-fork.json`. Work starts from the active baseline on short-lived
`fix/*`, `feat/*`, `build/*`, or `sync/upstream-*` branches and is merged back
before a release tag is created. A moving upstream mirror is never merged into
a fixed release baseline.

Fork releases use only `retrom-core-<upstream-baseline>-rN` tags. For a new
upstream without a tag, the baseline token is `g` plus 12 hexadecimal commit
characters; the release metadata still records the full commit. Tags and
assets are immutable, and aliases such as `latest`, `stable`, and the retired
`rpg-runtime-*` and `retrom-web-*` namespaces are not supported. This aggregate repository pins the
fork repository, stable tag, tag commit, filenames, and adapter ABI.
