# retrom-runtime

`retrom-runtime` is a host-independent browser library and release bundle for RPG Maker 2000, 2003, XP,
VX, VX Ace, MV and MZ, plus ONS games powered by ONScripterYuri. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core
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

Runtime JS/Wasm is not committed. The tag workflow downloads the fixed upstream releases and builds the fixed
ONScripterYuri tag with the small host save/load patch in `assets/runtime/ons/host-api.patch`. It then produces:

- `release/retrom-runtime-<version>.tar.gz`
- `release/xxxsen-retrom-runtime-<version>.tgz` (installable npm package)
- `release/retrom-runtime-release.json`

The repository keeps one current asset for each runtime role and never creates parallel versioned asset
directories. The `retrom-runtime` Git tag versions the complete set; older sets remain available only from their
immutable release tags.

Adapter IDs and asset paths describe roles, not migration revisions. Version selection happens only at the
repository release tag; the source tree and each release contain one implementation per runtime role.
SHA-256 values in release metadata detect corrupt downloads; compatibility identity is the immutable
`retrom-runtime` tag and its recorded upstream repository, tag and commit.

The mkxp core still serializes into its fixed 256 MiB memory buffer. The adapter does not upload that zero-padded
buffer directly: it trims the unused zero tail in bounded asynchronous chunks, compresses the meaningful prefix in a worker and stores a compact
`mkxp-state-compact` checkpoint. Restore expands the checkpoint back to the exact 256 MiB core buffer before the
private load hotkey is sent. This is an aggregate-runtime ABI; the pinned upstream core Release continues to expose
its raw serializer ABI and does not need a host-specific patch for compression.

## Adding and integrating a core

1. Add the runtime entry and adapter implementation without aliases or fallback implementations.
2. Add adapter unit tests and a small owned or redistributable compatibility fixture. Private operator games may
   be used for an ignored local smoke but never enter Git or ordinary automated tests.
3. Open a PR to `master`; the quality workflow runs lint, types, unit tests and the package build.
4. Publish a prerelease tag such as `v0.3.0-rc.1`.
5. A host application changes its runtime pin on a short-lived integration branch; production keeps its stable pin.
6. Run the host's real import/launch/save/restore product test for the new core.
7. Publish the stable tag and merge the host's single pinned runtime tag change after the candidate passes.

This keeps core development independent: a new core can be tested without replacing the stable runtime used by
other games or requiring unrelated host changes.

## Maintaining upstream forks

The Player `master` and mkxp-z Web `main` branches are unmodified,
fast-forward-only upstream mirrors. Retrom changes live on one active
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
