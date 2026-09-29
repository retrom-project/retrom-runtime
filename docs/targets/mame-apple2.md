# MAME driver-family candidates

`retrom-runtime/mame-apple2` uses `retrom-mame-dylink-v1`: a common JS/WASM runtime
plus one selected family side module. All bytes go through verified Content I/O assets
and its persistent cache. Each Launch creates fresh WASM memory and registers one
family; only immutable bytes are reused. Assets from different native builds
cannot be combined. Adding another family can change the common module's imports
and require a new build and download. This candidate is not a stable core release.

The first target selects `apple2p`, Disk II in slot 6 and an Apple joystick. It
accepts one read-only 143360-byte DOS-order `.dsk`/`.do`. Required external firmware:
`341-0011.d0`, `341-0012.d8`, `341-0013.e0`, `341-0014.e8`, `341-0015.f0`,
`341-0020-00.f8`, `341-0036.chr`, `341-0027-a.p5` (card), `341-0028-a.rom` (controller).
Firmware and game acquisition uses the host's explicit resource identities.
Other Apple models, formats and writable media are not product targets.

`mame-atom` selects Acorn Atom and the Acorn family, with its default RAM expansion
and disabled disk expansion. It accepts a single ATM quickload file: a 22-byte
header, nonempty matching payload, and a load range within the 16-bit address space.
It requires `abasic.ic20` (8192 bytes) and `afloat.ic21` (4096 bytes). Machine code
runs at its declared execution address; BASIC may need a physical `RUN` command.
UEF cassette and disk media are outside this target.

`mame-pv1000` selects Casio PV-1000 and the vintage family. It accepts one
8/16/32 KiB cartridge, without external firmware. Its D-pad/left stick map to
native digital directions; A/B map to native buttons 1/2.

Atom directions map to semicolon, period, Z and X. A maps Space, B/Start Return
and Select Escape. This profile supports games using those keys, including GUNTUS.
Physical keyboard controls remain available for other software.

The D-pad and left stick control native joystick axes; A/B map to joystick buttons
1/2. X maps Space, Y maps Enter, Select maps Escape and Start maps the `1` key.
Each button emits exactly one target input. Physical keyboard state is independent;
pause, blur, visibility changes and exit release inputs. Mapping sufficiency depends
on the game: Donkey Kong's one-player selection uses Start and its jump uses A.

The native framebuffer uses non-square pixels. MAME's display aspect ratio feeds
the shared frame surface, which preserves that ratio while resizing the window.
Screenshots resample to square pixels at the same display ratio; the Apple II+
560 by 192 buffer therefore produces a 560 by 420 screenshot at 4:3.

Instant saves use `mame-state-v1`: native state with machine and content identity, native-build
identity, length and SHA-256. The limit is 64 MiB. The public Provider layer writes
`mame-state-v1-storage-v1` with one gzip layer. Corrupt, mismatched or oversized state
fails restore instead of restarting the game. Native-build changes invalidate these
saves; the tightly coupled MAME C++ state ABI is not promised across versions.

The host must deliver Brotli companions for the large common module. Content I/O
verifies decoded bytes against the Provider asset index. Encoded game/firmware
responses and all encoded Range responses remain rejected. Cache eviction or
unavailable storage can require a later download. Reduced transfer size does not
remove the browser's decompression, compilation and linear-memory costs.
