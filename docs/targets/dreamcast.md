# Dreamcast / Flycast

The EmulatorJS Provider includes a Flycast WASM JIT Target for single-file Dreamcast CHD.
It requires WebGL2 and installed `dc/dc_boot.bin` + `dc/dc_flash.bin`, uses standard gamepad
controls, and supports bounded `flycast-state-gzip-v1` instant checkpoints, with lossless gzip compression
and compatibility with existing raw `flycast-state-v1` saves. CHDs are streamed
through SHA-256 validation into OPFS; cache hits are revalidated, and unavailable storage
falls back to a validated Blob. The cache contains no launch authorization or save state.
WinCE/MMU games, arcade variants, disc switching and netplay are outside this target.

The core comes from `retrom-project/flycast-wasm` release `retrom-core-1.0-r1`.
`src/providers/emulatorjs/source-catalog.ts` pins its repository, tag commit, asset digests,
sizes and adapter ABI. Provider builds verify the published release metadata and license texts.

Local core changes remain explicit PFB candidates. Build the core in the same PFB, then run:

```bash
npm run candidate:build -- --spec <absolute-pfb-spec> --output <empty-runtime-candidate-directory>
```

Formal builds reject unpublished overrides. A changed core requires a new verified release
and a higher EmulatorJS Provider version.
