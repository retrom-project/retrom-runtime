# retrom-runtime

`retrom-runtime` is a host-independent browser library and release bundle for RPG Maker 2000, 2003, XP,
VX, VX Ace, MV and MZ, ONS games powered by ONScripterYuri, and KAG-based KiriKiri2 games. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core
Release inputs. It does not know about a host application's users, database, review flow, storage or HTTP API.

## Public API

```ts
import { createRpgRuntime, type RpgRuntimeConfig } from "@xxxsen/retrom-runtime";

const runtime = createRpgRuntime(config, {
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

ONS is a separate public runtime rather than an RPG Maker generation:

```ts
import { createOnsRuntime, type OnsRuntimeConfig } from "@xxxsen/retrom-runtime";

const runtime = createOnsRuntime(config, { frameWindow, restorePayload });
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

Each session must use its own frame. `exit()` pauses the core and removes library-owned DOM and globals; the host
then discards that frame to release Emscripten's document-level input hooks.

KiriKiri is also an independent runtime:

```ts
import { createKirikiriRuntime, type KirikiriRuntimeConfig } from "@xxxsen/retrom-runtime";

const runtime = createKirikiriRuntime(config, { frameWindow, restorePayload });
await runtime.mount(container);
const checkpoint = await runtime.checkpoint();
```

The first compatibility line is deliberately limited to games exposing the standard KAG
`saveBookMark`/`loadBookMark` API. Its checkpoint contains the small native KAG save files written under
`/savedata` or `/save`; it is not a raw Wasm memory snapshot. A pure TJS/custom-engine title without these KAG
methods fails closed as unsupported instead of producing a checkpoint that cannot be restored. The host supplies
a project file index and, only when that project contains multiple XP3 archives, the explicit project-relative XP3
entry selected during import. Runtime slot `1999` is outside the normal KAG save menu and produces the special
`data1999.ksd` bookmark used by the host checkpoint bundle.

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

Runtime JS/Wasm is not committed or built here. EasyRPG, mkxp, ONScripterYuri and KiriKiri are maintained in
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

Use key `kirikiri2` for the KiriKiri fork. The same environment is inherited by Retrom's
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

The Player `master`, mkxp-z Web `main`, ONScripterYuri `master`, and KiriKiri
Web `web` branches are unmodified, fast-forward-only upstream mirrors. Retrom changes live on one active
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
