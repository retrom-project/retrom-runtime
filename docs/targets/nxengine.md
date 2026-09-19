# Cave Story / NXEngine

`nxengine` accepts a `FILE_TREE` containing original freeware `Doukutsu.exe` and the complete `data/` directory. The maintained [libretro fork](https://github.com/retrom-project/nxengine-libretro) supplies a software-rendered Wasm core, `nxengine-host-v1`, 320×240 RGBA and 22050 Hz stereo PCM. The adapter owns bounded materialization, immutable-URL Cache Storage reuse, whole-project progress and standard joypad/independent keyboard input. Limits: 4096 files, 32 MiB per file, 64 MiB total. Original filename case is retained, apart from the executable marker.

The target declares `GAME_SAVE`: save at a native game save point, then export through the host. `nxengine-game-save-v1-storage-v1` is the common single-gzip envelope around an identity-bound JSON container of up to five native 1540-byte profile slots. Explicit restore imports slots before native startup; use the game's Load menu to resume. Fresh launches never import previous files implicitly. No instant state, netplay, CS+ or arbitrary mod compatibility is advertised.

The source catalog pins an immutable core fork release, its commit, adapter ABI and complete asset digests. The product acceptance contract lives in Retrom's `ACC-NXENGINE-001`; game data is never packaged in this repository.
