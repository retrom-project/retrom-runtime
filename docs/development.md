# Development and releases

## Local development

Use Node.js 24 and the npm version recorded in [package.json](../package.json).

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
npm run docs:platforms:check
```

`npm run build` compiles TypeScript and the project's own browser bridges. It does not compile third-party cores. `npm test` runs this build before the test suite. The package check verifies the packaged runtime and offline host tool independently of the source checkout.

After changing platform names, core names, product bindings or Provider declarations, run `npm run docs:platforms` and commit the generated [support catalog](supported-platforms-and-cores.md) with the change. The quality workflow rejects an outdated catalog.

## Provider packaging

Provider builds aggregate the fixed release assets declared in [provider-sources.json](../provider-sources.json) and the [EmulatorJS source catalog](../src/providers/emulatorjs/source-catalog.ts). Third-party source changes and core compilation belong to the maintained forks; see [Adding a core](adding-a-core.md) and [Maintaining upstream forks](maintaining-forks.md).

Before publishing a release tag, also run:

```bash
npm run provider:input:check
npm run provider:build
npm run provider:check
npm run release:build
```

These commands verify the pinned upstream assets, Provider bundles, licenses and aggregate release. Code and package checks establish their own scope; real game import, play, input and save/restore acceptance remain separate host-product checks.

## Versioned artifacts

An immutable GitHub tag `vX.Y.Z` is the release version source. Both Provider manifests, client exports and archive names use `X.Y.Z`. Source files do not maintain an independent package or Provider release version. GitHub archives are the distribution artifacts; this repository is not published to npm.

Each release contains:

| Artifact | Contents |
| --- | --- |
| `emulatorjs-provider-X.Y.Z.tar.gz` | EmulatorJS Provider bundle |
| `retrom-runtime-provider-X.Y.Z.tar.gz` | Independent Web/Wasm Provider bundle |
| `retrom-runtime-host-tool-X.Y.Z.tar.gz` | Offline host tool and production dependencies |
| `runtime-inputs.json` | Source identity, artifact names, byte sizes and checksums for the matched set |

Formal builds require a validated annotated tag at the released commit and `RETROM_PROVIDER_BUILD_MODE=release`. Untagged candidate builds use `0.0.0-dev`; their descriptor has `release: null`. Tagged releases include the actual tag and commit. A PFB client receives the installed base's verified Provider manifest version.

Every build records the actual source-tree digest and both verified Provider archive/module hashes alongside the host-tool archive. Consumers must use the matched set rather than combining artifacts based only on a version string.

## Transport and local candidates

Transport the host-tool archive and both Provider archives as three flat basenames alongside `runtime-inputs.json`. Provider records retain their `providerId/archive` paths; consumers use the validated basename for local-directory or HTTPS transport. The descriptor fixes identity, independently of the transport address.

Local core candidates are explicit development inputs. They do not replace stable release pins or add Target declarations. Candidate assets must match the declared source, metadata and adapter ABI before entering a Provider; core-specific asset closure rules are described in [Maintaining upstream forks](maintaining-forks.md#candidate-asset-closures).
