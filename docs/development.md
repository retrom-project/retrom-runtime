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

An immutable GitHub tag `vX.Y.Z` is the release version source. Both Provider manifests, client exports and chunk manifest names use `X.Y.Z`. Source files do not maintain an independent package or Provider release version. GitHub release assets are the distribution artifacts; this repository is not published to npm.

Each release contains:

| Artifact | Contents |
| --- | --- |
| `<providerId>-chunks-X.Y.Z.json` | Chunk manifest of one Provider bundle (EmulatorJS and the independent Web/Wasm Provider) |
| `<providerId>-chunk-<chunkId>.tar.gz` | One content-addressed chunk of a Provider bundle |
| `retrom-runtime-host-tool-X.Y.Z.tar.gz` | Offline host tool and production dependencies |
| `runtime-inputs.json` | Source identity, artifact names, byte sizes and checksums for the matched set |

Provider bundles are published only as chunks; there is no whole Provider archive. A bundle is identified by `bundleSha256`, the SHA-256 of its `integrity.json`, which lists every path, size, hash and media type. Chunks follow stable rules so unchanged content keeps the same chunk identity across releases and consumers download only changed chunks:

- one chunk per `assets/<core>/` directory, per EmulatorJS core (`assets/<version>/data/cores/<core>-*`), per EmulatorJS version's shared files, and per `licenses/**/forks/<fork>/` directory; the remaining small root files, `assets/content-io/` and other licenses form one common chunk;
- a chunk above 32 MiB is split by deeper directories until each chunk is at most 32 MiB or a single file.

`chunkId` is the SHA-256 of the chunk's sorted `[path, sizeBytes, sha256]` list, so local deduplication does not depend on compression. Archives are deterministic ustar + gzip. The release gate reads every chunk back, checks its identity and archive digest, and requires the chunks together to reproduce the built bundle exactly once; a release may not exceed 900 assets.

Formal builds require a validated annotated tag at the released commit and `RETROM_PROVIDER_BUILD_MODE=release`. Untagged candidate builds use `0.0.0-dev`; their descriptor has `release: null`. Tagged releases include the actual tag and commit. A PFB client receives the installed base's verified Provider manifest version.

Every build records the actual source-tree digest and both verified Provider bundle, chunk-manifest and module hashes alongside the host-tool archive. Consumers must use the matched set rather than combining artifacts based only on a version string.

## Transport and local candidates

Transport the host-tool archive, both chunk manifests and every chunk archive as flat basenames alongside `runtime-inputs.json`. Provider records name their chunk manifest; consumers use the validated basenames for local-directory or HTTPS transport. The descriptor fixes identity, independently of the transport address.

Local core candidates are explicit development inputs. They do not replace stable release pins or add Target declarations. Candidate assets must match the declared source, metadata and adapter ABI before entering a Provider; core-specific asset closure rules are described in [Maintaining upstream forks](maintaining-forks.md#candidate-asset-closures).
