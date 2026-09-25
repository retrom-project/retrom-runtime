# Dreamcast / Flycast

The EmulatorJS Provider includes a Flycast WASM JIT Target for single-file Dreamcast CHD.
It requires WebGL2 and installed `dc/dc_boot.bin` + `dc/dc_flash.bin`, uses standard gamepad
controls, and supports bounded `flycast-state-gzip-v1` instant checkpoints, with lossless gzip compression
and compatibility with existing raw `flycast-state-v1` saves. The Flycast
content bridge serves bounded CHD reads from the shared Content I/O Range
reader. Startup does not materialize the complete CHD; the core requests
compressed hunks as it needs them.
WinCE/MMU games and disc switching are outside this target. NAOMI, NAOMI 2,
and Atomiswave cartridges use separate Flycast Targets described in
[`flycast-arcade.md`](./flycast-arcade.md).

The core comes from `retrom-project/flycast-wasm` release `retrom-core-1.0-r2`.
`src/providers/emulatorjs/source-catalog.ts` pins its repository, tag commit, asset digests,
sizes and adapter ABI. Provider builds verify the published release metadata and license texts.

Local core changes remain explicit PFB candidates. Build the core in the same PFB, then run:

```bash
npm run candidate:build -- --spec <absolute-pfb-spec> --output <empty-runtime-candidate-directory>
```

Formal builds reject unpublished overrides. A changed core requires a new verified release
and a higher EmulatorJS Provider version.
