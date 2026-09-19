# PX68K (Sharp X68000)

The `px68k` target uses `px68k-host-v1` and accepts one DIM, XDF or HDF image
(up to 64 MiB). The host supplies `iplrom.dat` and `cgrom.dat` as verified
`EXTERNAL_FILE_SET` entries. D88, M3U playlists and drive switching are not
advertised. Keyboard input and two standard gamepads are supported. Standard
Button 0/1 map to native joypad A/B without synthesizing Enter/Escape; keyboard
arrows, letters, Enter, Escape and F1–F12 go directly to the emulated keyboard.
Arrow keys and Z/X also operate joypad one (directions and A/B), allowing keyboard
play in games that only read a joystick. Click the game canvas to focus keyboard
input. Video, stereo audio, pause, volume,
screenshots and `px68k-state-v1` instant checkpoints share the Provider lifecycle.
Checkpoints contain machine state and writable disk contents; a new launch
restores only an explicitly supplied checkpoint belonging to the same game.

PX68K is pinned to the maintenance release `retrom-core-g561dcba6b11d-r1`
with exact commit, sizes and SHA-256. PFB development overrides use the core
fork's descriptor-verified candidate workflow; formal releases reject overrides. Inherited engine licensing
includes a noncommercial clause; see the complete bundled `LICENSES.txt` and
`THIRD_PARTY_NOTICES.md` before distribution.
