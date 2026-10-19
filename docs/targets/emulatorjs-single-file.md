# EmulatorJS cartridge, computer and disc cores

The `emulatorjs` Provider exposes separate Targets for its cartridge, computer, disc and project integrations. Use the generated [support catalog](../supported-platforms-and-cores.md) for the platform/core mappings. A single upstream emulator can back several Targets with different machine options or content policies.

## Content and dependencies

Ordinary `SINGLE_FILE` bindings select one entry file. A supported single-disc CUE can include its verified referenced tracks through the runtime resource plan; this does not add multi-disc switching. DOS, arcade ZIP sets, Daphne and Lutro have additional rules in the [Target guide index](README.md).

The [format catalog](../../src/runtime/content-formats.json) contains discovery metadata from core descriptors. Extension recognition alone does not establish playable support: the selected Target, content preparation and adapter still validate the actual input. M3U playlists, arbitrary project directories and upstream-only features must not be inferred from that list.

Supply BIOS and Parent resources exactly as returned by runtime preparation. Declared `requiresThreads` capabilities need cross-origin isolation; individual graphics or media requirements can be stricter. Most Targets use `INSTANT` saves, while Lutro uses `GAME_SAVE` and Daphne uses `NO_SAVE`. Follow the selected Target's public checkpoint format rather than exchanging states between different cores.

Sources are pinned in the [EmulatorJS source catalog](../../src/providers/emulatorjs/source-catalog.ts), including official frontend inputs and maintained fork releases. Release pins, source archives and licenses remain authoritative there; the guide does not maintain a second version list. Core, game and firmware acquisition use shared [Content I/O](../content-io.md) and the selected Target's policy.

## Core-specific notes

Fuse enables direct keyboard input and configures controller one as Kempston, with controller two
disabled to avoid competing joystick ports. Its standard pad uses the libretro controls, including
Space/Return shoulder buttons for keyboard-oriented title menus. Instant restore retains the
minified 4.2.3 loader, enables native state diagnostics internally, and waits for the asynchronous
native load callback and its error result. Exit runs EmulatorJS's native cleanup before disposal.
New core admission still requires a real host import, preview, product launch, visible input
response and checkpoint restore into a fresh instance; passing serialization alone is insufficient.

O2EM uses the `retrom-project/libretro-o2em` fork Release for Odyssey² / Videopac `.bin`
cartridges. Its `o2rom.bin` firmware is supplied by the user and delivered as a BIOS bundle.
Keyboard input starts a game; standard gamepad direction and action are mapped for both
players. The browser build does not include The Voice speech hardware. The fork release
pins the Web core, source archive, license and metadata. Product verification must cover
real import, launch, input and cross-launch checkpoint restore.

SAME CD-i configures both digital pointer increments to 20 through its native
MAME machine configuration before startup. This keeps both movement signs above
games' pointer quantization threshold while preserving native button sequences
and physical mouse sensitivity. The same configuration applies before checkpoint
restoration; PAL execution remains 50 Hz.

The maintained SAME CD-i source includes CDIC startup and sound-map restart timing fixes. Its immutable release descriptor, complete source archive and COPYING are pinned in the source catalog. Compare audio after a fresh boot: a checkpoint
can retain the guest audio driver state responsible for periodic interruptions.
