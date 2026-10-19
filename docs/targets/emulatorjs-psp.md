# EmulatorJS PSP

`emulatorjs/ppsspp` is declared by the Provider but has no product binding. The product `psp` platform uses the independent [PPSSPP Target](ppsspp.md). The details below describe this declared component; they do not add a second selectable PSP core.

The separate `emulatorjs` Provider declares its targets in `src/providers/emulatorjs/catalog.ts`.
PSP uses the threaded PPSSPP core from the pinned EmulatorJS 4.3.0-pre release, with the CPU
execution mode and optimizations supplied by that core. Its private adapter resolves the upstream
PSP resource archive and core report to immutable bundle assets without external update requests.

For pixel and original video modes, PSP bounds the internal output viewport to 960×544 and scales
it uniformly to the host surface. This preserves the full image and limits output work on high-DPI
screens; it does not change the game's internal rendering resolution. Native settings keep that viewport so opening a menu does not clear a paused frame. Shader modes
retain the full host viewport. Resize observation and styles are released on exit.

Checkpoints use the single-gzip [Provider storage contract](../provider-module-v1.md), with public format `emulatorjs-state-v1-storage-v1`. PSP stops the
main loop while awaiting native Asyncify save/load calls; restored sessions skip boot-dialog input.
