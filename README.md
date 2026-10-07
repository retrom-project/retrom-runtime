# retrom-runtime

Host-independent browser library and release bundle for retro game runtimes. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core release inputs. It owns game-specific configuration, implementation selection, content identities and dependency declarations. Host applications own users, databases, review, storage and HTTP authorization.

## Documentation

Supported targets, Provider Module architecture and core integration guides are maintained in the [docs](docs/) directory.

Game configuration, fingerprints, dependency preparation and the offline host tool are described in [Runtime module](docs/runtime-module.md). Managed game acquisition and cache/bridge ownership are described in [Content I/O v1](docs/content-io.md).

## Provider Module V1

Hosts integrate the generated Provider Bundle. A Bundle exports one `client.mjs`:

```ts
export const providerId = "retrom-runtime";
export const providerVersion = "0.46.0"; // derived from release tag v0.46.0
export const providerApiVersion = 1;
export async function createRuntime(
  value: unknown,
  host: RuntimeHostV1,
): Promise<PlayerRuntimeV1>;
```

The host validates a Launch Envelope V1, verifies the module URL and SHA-256 against the active Bundle, imports the module, checks the exported identity and calls `createRuntime`.

## Release versions

The immutable GitHub tag is the only release version source. Tag `v0.46.0` produces both `retrom-runtime-provider-0.46.0.tar.gz` and `emulatorjs-provider-0.46.0.tar.gz`, plus an offline `retrom-runtime-host-tool-0.46.0.tar.gz`; manifests, client exports and release metadata all use `0.46.0`. There is no maintained package version or per-Provider version in source. The repository is private to npm publishing; GitHub archives are the release artifacts.

Formal builds require a validated annotated tag at the released commit and `RETROM_PROVIDER_BUILD_MODE=release`. Untagged candidate builds use `0.0.0-dev`. Every build emits `runtime-inputs.json` with the actual source-tree SHA, offline host tool and both verified Provider archive/client hashes. Candidates have `release: null`; tagged releases include the real tag and commit. PFB clients receive the installed base's verified manifest version.

Transport the host-tool archive and both Provider archives as three flat basenames alongside `runtime-inputs.json`. Provider records retain their `providerId/archive` paths; consumers take the validated basename for local-directory or HTTPS transport. The tracked descriptor fixes identity; a transport URL does not select hashes or source.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
```

Before publishing a release tag, also run:

```bash
npm run provider:input:check
npm run provider:build
npm run provider:check
npm run release:build
```

The current ONS checkpoint implementation is unpublished. Its immutable candidate ZIP is declared in `provider-sources.json` with exact bytes, size and compiled-source digest. A clean checkout prepares an explicitly supplied archive directory, then builds the paired candidate:

```bash
mkdir -p .cache
prepared_core_input="$(node scripts/prepare-core-candidates.mjs --archive-root "$CORE_ARCHIVE_ROOT" --output "$PWD/.cache/core-inputs")" &&
RETROM_RUNTIME_DEV_RELEASE_OVERRIDES="${prepared_core_input#*=}" RETROM_PFB_CANDIDATE_BUILD=1 npm run release:build
```

`CORE_ARCHIVE_ROOT` contains the one declared ZIP basename; the output directory must be absent. CI uses `RETROM_CORE_CANDIDATE_BASE_URL` only to transport that same hash-pinned ZIP. Missing transport fails with `CORE_CANDIDATE_TRANSPORT_REQUIRED`; a normal build without explicit candidate mode fails with `UNPUBLISHED_CORE_INPUT`. Both release paths verify the native checkpoint-ready binding. There is no fallback to the old ONS release. Formal publication first requires an immutable ONS core release and its source pin, then a new runtime tag publishing the paired descriptor and archives. Existing tags remain unchanged.

For PFB upstream-sync validation, Butterscotch candidates include their metadata
parser pair for integrity verification, but only the game runner and license
override the installed Provider. The metadata tools are outside its public asset
closure. EasyRPG candidates use the existing two-file JS/Wasm release contract;
the installed Provider retains its separately collected license notices. These
local inputs do not change release pins or Target declarations.

## License

MIT

### Host keyboard and program selection

Each Target owns its host shortcut policy through `hostKeyboardShortcuts`. The public
`PlayerRuntimeV1.getInputCapabilities()` exposes the allowed `PAUSE` / `MENU` shortcuts;
`setHostShortcutPolicy()` selects explicit keyboard bindings and `HOST_SHORTCUT` events cross same-origin
and isolated game windows uniformly. Null policy disables interception; see the Provider Module guide.
The Host leaves undeclared shortcuts with the game and configures null while its overlays own input.
A checkpoint availability with `requiredAction: "SELECT_PROGRAM"` tells the host to show
program selection guidance. Provider-private Target options are interpreted only inside
the Provider.
