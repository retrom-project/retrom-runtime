# EmulatorJS bsnes

The optional bsnes SNES target uses the pinned EmulatorJS 4.3.0-pre frontend and
`retrom-project/bsnes-libretro` release `retrom-core-g4b344745e387-r1`.
Its Asyncify fiber and native callback bridge support asynchronous instant snapshots.
The distinct `bsnes-state-v1-storage-v1` format prevents exchanging incompatible
snapshots with Snes9x; standard SNES input remains available after a fresh-instance restore.
