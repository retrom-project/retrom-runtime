# Fantasy consoles and Lutro

The `tic80` and `fake08` targets consume independent Emscripten factories from the maintained
`retrom-project/TIC-80` and `retrom-project/fake-08` forks. They accept one verified ROM_BLOB cartridge
(up to 8 MiB at the shared input boundary, with native cartridge validation), present Canvas/WebAudio, standard gamepad or directional/action keyboard input,
and release their frame loop, heap instance, input listeners and audio on exit.
TIC-80 saves 1024 bytes of pmem with GAME_SAVE semantics, pre-BOOT restoration, native change revisions
and snapshot-specific acknowledgment. FAKE-08 uses an INSTANT execution checkpoint including input-repeat
and cartdata state. Their envelopes bind the state to the core and cartridge SHA-256.

The provider pins immutable core releases from the maintained upstream snapshots:
TIC-80 `retrom-core-g4aba09c98f1e-r1` and FAKE-08 `retrom-core-g814991a2571a-r2`.
`provider-sources.json` records each release's exact repository, tag commit, asset filenames and ABI.
Core builds remain owned by the forks; runtime builds download and verify the published release identities.

## WASM-4

`retrom-runtime/wasm4` accepts one verified `.wasm` cartridge of at most 64 KiB. Its dedicated runtime supplies video, standard controls, pause, screenshots and frame counting. Volume adjustment is not declared. It uses `PRELOAD_ONLY` for the small cartridge and `INSTANT` saves with public format `wasm4-state-v1-storage-v1`; restoration is bound to the same cartridge content.

## Lutro

`emulatorjs/lutro` accepts the selected Lua/Lutro cartridge supported by its core. Archive cartridges remain intact for the native loader. It declares `GAME_SAVE`, exporting the core's native save filesystem through `lutro-native-v1-storage-v1`; this does not serialize the Lua VM execution state. The game must write meaningful native save data, and the host imports that data before a new native instance starts.

Sources: [fantasy input limit](../../src/fantasy-console/fetch.ts), [TIC-80/FAKE-08 checkpoint codecs](../../src/fantasy-console/state.ts), [WASM-4 adapter](../../src/wasm4/adapter.ts), [Lutro native saves](../../src/providers/emulatorjs/lutro-native-save.ts), and the [support catalog](../supported-platforms-and-cores.md).
