# EmulatorJS PSP

The separate `emulatorjs` Provider declares its targets in `src/providers/emulatorjs/catalog.ts`.
PSP uses the threaded PPSSPP core from the pinned EmulatorJS 4.3.0-pre release, with the CPU
execution mode and optimizations supplied by that core. Its private adapter resolves the upstream
PSP resource archive and core report to immutable bundle assets without external update requests.

For pixel and original video modes, PSP bounds the internal output viewport to 960×544 and scales
it uniformly to the host surface. This preserves the full image and limits output work on high-DPI
screens; it does not change the game's internal rendering resolution. Native settings keep that viewport so opening a menu does not clear a paused frame. Shader modes
retain the full host viewport. Resize observation and styles are released on exit.

All Provider checkpoints now use the common storage codec described in the main README. PSP still stops the
main loop while awaiting native Asyncify save/load calls; restored sessions skip boot-dialog input.
