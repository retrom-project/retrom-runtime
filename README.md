# retrom-runtime

`retrom-runtime` is a host-independent browser library and release bundle for RPG Maker 2000, 2003, XP,
VX, VX Ace, MV and MZ. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core
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

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
```

Runtime JS/Wasm is not committed. `npm run release:build` downloads assets from the immutable upstream tags in
`runtime-manifest.json`, checks their release metadata, and produces:

- `release/retrom-runtime-<version>.tar.gz`
- `release/xxxsen-retrom-runtime-<version>.tgz` (installable npm package)
- `release/retrom-runtime-release.json`

The repository keeps one current asset for each runtime role and never creates parallel versioned asset
directories. The `retrom-runtime` Git tag versions the complete set; older sets remain available only from their
immutable release tags.

Adapter IDs and asset paths describe roles, not migration revisions. Version selection happens only at the
repository release tag; the source tree and each release contain one implementation per runtime role.

## Adding and integrating a core

1. Add a distinct runtime entry and adapter implementation; do not change existing entries or add fallback.
2. Add adapter unit tests and a small owned or redistributable compatibility fixture.
3. Open a PR to `master`; the quality workflow runs lint, types, unit tests and the package build.
4. Publish a prerelease tag such as `v0.2.0-rc.1`.
5. A host application points only its development override at that prerelease bundle and adds an unselected
   candidate route. Existing selected routes remain unchanged.
6. Run the host's real import/launch/save/restore product test for the new core.
7. Publish the stable tag and update the host's pinned tag/commit after the candidate passes.

This keeps core development independent: a new core can be tested without replacing the stable runtime used by
other games or requiring unrelated host changes.
