# retrom-runtime

Host-independent browser library and release bundle for retro game runtimes. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core release inputs. It does not know about a host application's users, database, review flow, storage or HTTP API.

## Documentation

Supported targets, Provider Module architecture and core integration guides are maintained in the [docs](docs/) directory.

Managed game acquisition and cache/bridge ownership are described in [Content I/O v1](docs/content-io.md).

## Provider Module V2

Hosts integrate the generated Provider Bundle. A Bundle exports one `client.mjs`:

```ts
export const providerId = "retrom-runtime";
export const providerVersion = "0.46.0"; // derived from release tag v0.46.0
export const providerApiVersion = 2;
export async function createRuntime(
  value: unknown,
  host: RuntimeHostV1,
): Promise<PlayerRuntimeV2>;
```

The host validates a Launch Envelope V1, verifies the module URL and SHA-256 against the active Bundle, imports the module, checks the exported identity and calls `createRuntime`.

## Release versions

The immutable GitHub tag is the only release version source. Tag `v0.46.0` produces both `retrom-runtime-provider-0.46.0.tar.gz` and `emulatorjs-provider-0.46.0.tar.gz`; manifests, client exports and release metadata all use `0.46.0`. There is no maintained package version or per-Provider version in source. The repository is private to npm publishing; GitHub Provider archives are the release artifacts.

Formal builds require a validated annotated tag at the released commit and `RETROM_PROVIDER_BUILD_MODE=release`. Untagged candidate builds use `0.0.0-dev` and do not publish formal release metadata. PFB clients receive the installed base's verified manifest version, so editing local adapters does not impersonate a new release.

This replaces the older independent EmulatorJS `2.x` sequence. Existing development databases and active Provider state must be archived and reset before activating the unified sequence; hosts must retain downgrade and same-version/different-digest protection. No compatibility migration is provided for unreleased development data.

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
`PlayerRuntimeV2.getInputCapabilities()` exposes the allowed `PAUSE` / `MENU` shortcuts;
hosts leave game keys untouched when this optional method is absent on an older Provider.
A checkpoint availability with `requiredAction: "SELECT_PROGRAM"` tells the host to show
program selection guidance. Provider-private Target options are interpreted only inside
the Provider.
