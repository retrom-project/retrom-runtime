# TIC-80 and FAKE-08

The `tic80` and `fake08` targets consume independent Emscripten factories from the maintained
`retrom-project/TIC-80` and `retrom-project/fake-08` forks. They accept one verified ROM_BLOB cartridge
(up to 4 MiB), present Canvas/WebAudio, standard gamepad or directional/action keyboard input,
and release their frame loop, heap instance, input listeners and audio on exit.
TIC-80 saves 1024 bytes of pmem with GAME_SAVE semantics, pre-BOOT restoration, native change revisions
and snapshot-specific acknowledgment. FAKE-08 uses an INSTANT execution checkpoint including input-repeat
and cartdata state. Their envelopes bind the state to the core and cartridge SHA-256.

The provider pins immutable core releases from the maintained upstream snapshots:
TIC-80 `retrom-core-g4aba09c98f1e-r1` and FAKE-08 `retrom-core-g814991a2571a-r2`.
`provider-sources.json` records each release's exact repository, tag commit, asset filenames and ABI.
Core builds remain owned by the forks; runtime builds download and verify the published release identities.
