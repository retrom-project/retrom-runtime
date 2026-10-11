# Dreamcast / Flycast

The EmulatorJS Provider includes a Flycast WASM JIT Target for single-file Dreamcast CHD and CDI.
It requires WebGL2 and installed `dc/dc_boot.bin` + `dc/dc_flash.bin` for CHD, uses standard gamepad
controls, and supports bounded `flycast-state-v1-storage-v1` instant checkpoints with one public gzip wrapper. The Flycast
content bridge serves bounded CHD reads from the shared Content I/O Range
reader. Startup does not materialize the complete disc; the core requests
CHD hunks or CDI tracks as it needs them. CDI metadata and tracks use independent
seekable file cursors with reads bounded to 256 KiB. The adapter preserves the
CDI extension, disables automatic CUE generation and uses the HLE bootstrap
validated by the paired product cases. CHD retains its existing BIOS selection.
Native content-load results distinguish failed game loading from a running
RetroArch frontend; acceptance still requires actual game input and state.
WinCE/MMU games and disc switching are outside this target. NAOMI, NAOMI 2,
and Atomiswave cartridges use separate Flycast Targets described in
[`flycast-arcade.md`](./flycast-arcade.md).

The core comes from `retrom-project/flycast-wasm` release `retrom-core-1.0-r5`.
`src/providers/emulatorjs/source-catalog.ts` pins its repository, tag commit, asset digests,
sizes and adapter ABI. Provider builds verify the published release metadata and license texts.

Local core changes remain explicit PFB candidates. Build the core in the same PFB, then run:

```bash
npm run candidate:build -- --spec <absolute-pfb-spec> --output <empty-runtime-candidate-directory>
```

Formal builds reject unpublished overrides. A changed core requires a new verified release
and a higher EmulatorJS Provider version.
