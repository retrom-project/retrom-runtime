# retrom-runtime

Host-independent browser library and release bundle for retro game runtimes. It owns runtime lifecycle, adapters, checkpoint codecs, bridge assets and pinned core release inputs. It does not know about a host application's users, database, review flow, storage or HTTP API.

## Documentation

Supported targets, Provider Module architecture and core integration guides are maintained in the [docs](docs/) directory.

Managed game acquisition and cache/bridge ownership are described in [Content I/O v1](docs/content-io.md).

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

## Symbian development candidate

The `symbian-eka2l1` Target uses the independent official EKA2L1 browser fork,
ABI `eka2l1-browser-v1`. It consumes an intact SIS/SISX plus the declared Nokia
5320 ROM/RPKG pair through common verified full-cache materialization. The core
installs the firmware and package. Games and firmware are operator inputs.
The source is intentionally in `developmentInputs` until a fixed core release
and the following Provider release are authorized; existing formal pins stay intact.

GAME_SAVE exports changed C/E files and tombstones, bounded to 64 MiB, and restores
before the application starts. Public storage performs one gzip layer. This is
native file storage, not RAM or do_state; system settings can create storage
changes, and users must save progress in their game's own menu before exiting.

The first acceptance scope is a Nokia 5320 S60v3 FP2 native 2D game using ARM
interpretation, pthreads, WebGL2 OffscreenCanvas and PCM audio. General guest
3D, compressed media, MIDI banks, other devices and mobile performance remain
unverified. Retrom's ACC-EKA2L1-001 exercises real import/preview/publish/launch,
standard direction/confirm/jump, native save/readback, offline input, persistent
cache reuse, preload cancellation/failure and desktop gameplay performance.
