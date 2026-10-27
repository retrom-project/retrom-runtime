# Standard gamepad and touch input

Browser standard buttons 0/1/2/3 are bottom/right/left/top (Xbox A/B/X/Y,
PlayStation Cross/Circle/Square/Triangle). Libretro slots B=0, A=8, Y=1 and
X=9 describe RetroPad positions. Core actions must be checked separately;
Nintendo letters, Sony positions and Sega A/B/C are different conventions.
Every physical button has one native destination. Keyboard bindings stay
independent. The host does not remap core inputs.

NES (Nestopia/FCEUmm) and digital Arcade (FBNeo, FBAlpha 0.2.97.44,
FBA2012 CPS1/CPS2, MAME2003/Plus) also accept the standard controller's left
stick as D-pad directions. The shared EmulatorJS polling adapter merges the
stick with the physical D-pad before dispatching button transitions. Either
source can hold a direction without the other source's release cancelling it.
When the sources disagree on an axis, the physical D-pad has priority; the
other axis can still form a diagonal. Stick activation is 0.5 and release is
0.35, preventing center drift and threshold jitter. Consumed left axes are
zeroed so they cannot also trigger a second native input. Right-stick and
face-button bindings stay unchanged. Disconnection supplies one neutral sample
before removal so EmulatorJS releases held controls.

This conversion is scoped to those digital layouts. Analog console controls
(including N64, Dreamcast and PlayStation) retain their existing axes. The
independent MAME current Arcade adapter already accepts both the left stick
and D-pad, with D-pad priority per axis.

| Core group | Bottom / right / left / top native slots | Policy |
| --- | --- | --- |
| FBNeo, FBA CPS1/CPS2, MAME2003/Plus, Supermodel; EJS PSX/PSP | 0 / 8 / 1 / 9 | Native positions; fixes both reversed face pairs |
| Flycast, NeoCD, Daphne, DOSBox Pure, PUAE, O2EM | 0 / 8 / 1 / 9 | Existing native positions retained |
| Atari800/XEGS/5200, Channel F, HatariB, VICE | 0 / 8 / 1 / 9 | Primary native action on bottom |
| NGP, SMSPlus, ProSystem, Stella2014, EightyOne, Theodore | 0 / 8 / 9 / 1 | Primary/secondary actions; unavailable slots are left unbound by EJS |
| N64 | 0 / 1 / unavailable / unavailable | Native N64 A/B; C buttons remain on the right stick |
| Nintendo and other letter-oriented cores | 8 / 0 / 9 / 1 | A/B/X/Y letter convention retained |
| Genesis Plus GX/GX Wide/PicoDrive (MD/CD/32X) | 1 / 0 / 10 / 9 | A/B/X/Y; C on R1 (8), Z on L1 (11) |
| Same Sega cores with SMS/SG/GG content | 0 / 8 / unavailable / unavailable | Native Button 1/2; selected from the content URL extension |
| Saturn | 1 / 0 / 9 / 10 | A/B/X/Y; C on R1 (8), Z on L1 (11) |
| 3DO | 1 / 0 / 8 / unavailable | Native A/B/C |
| PX68K | 0 / 8 / 9 / 1 | TRIG1/TRIG2 with the core's default VbtnSwap=0 |
| MKXP XP/VX/VX Ace | A / B / X / Y | Explicit RetroArch bindings: RGSS Confirm / Cancel / Shift / auxiliary X |

MKXP reads the keyboard directly with desktop mkxp-z's RGSS defaults: arrows
move; Enter, Space and Z confirm (Z is A and C confirms on XP); Escape, X and
numpad 0 cancel; Left Shift, A, S, D, Q and W are RGSS A/X/Y/Z/L/R. RetroArch's
player-1 keyboard RetroPad and lightgun binds are cleared so no key also reaches
the game through a second, conflicting RetroPad mapping.

Native Targets opt into the shared on-screen gamepad with a layout and, when
needed, their actual input window. TIC-80 and MKXP use STANDARD, PPSSPP uses PSP
(D-pad, analog stick, Sony face labels, L/R and Start/Select), KiriKiri uses
POINTER (directions and confirmation/cancel), and Apple2JS uses JOYSTICK in its
nested frame. RPG Maker MV runs the same module through its isolated input
bridge. On touch-first devices (no hover, coarse pointer), it is a
standard-mapping pad merged into slot 0 (OR-ed with a physical player 1 pad)
before the host input filter, so suppression and Select+Start chords apply to
it, and each core keeps its own gamepad mapping (MKXP: A confirm, B cancel).
Each finger owns one control; the D-pad has a central dead zone and diagonals.
Both digital and analog sticks use the EmulatorJS-style translucent red circular
base and half-size red cap. The cap follows its owning touch within the base;
release, cancellation, blur and hiding recentre it without changing input mapping.
Using a physical controller temporarily hides it until the next touch. The Host
passes `touchGamepadEnabled` before mount and can use `getTouchGamepad()` to change
the preference after mount. Explicitly disabling the pad releases all virtual
input; touching the game cannot re-enable it. Pause and Host suppression release
virtual input without changing that preference. Cursor polling reads the merged
physical/touch source without advancing the Host chord filter.
Same-origin background checkpoint exports release held controls while retaining the previous
layout visibility, so automatic native saves do not make the controls blink or
show a paused game's pad. The Host keeps its toolbar toggle in place while busy.

Blur, hiding the page or exit release every held control. MKXP samples the frame's filtered Gamepad API
through `Module.retromGamepadNavigator`, because its core module runs in the
Provider realm.

Theodore's Fire is native B=0; native Y=1 moves its virtual keyboard. Space
is native A=8. PC88 continues to use native Start=3 for Return on the bottom
button, with native A=8 (X key) on physical Start.

Touch labels use the same native actions, rather than the generic EJS Xbox
labels on Nintendo/letter cores. Explicit layouts cover Azahar, all three NDS
cores, Arduboy, Duck Hunt LCD, Supervision, Gearboy, Lutro, PrBoom, Same CD-i,
Intellivision, Fuse, CPC, Vectrex, Thomson and PC88. CPC distinguishes Fire
1/2/3 and Space; Vectrex uses numbered buttons. Native NDS settings retain
stylus, analog sticks and triggers independently of the touch layout.

Fuse's native A is Fire and B is Up. FreeIntv's A/B are left/right actions.
Same CD-i's default native A is its first MAME button. These retain their
entity mappings; only misleading touch labels change. The independent native
MAME, PPSSPP and Play! adapters retain their existing correct mappings.

Input regressions exercise press/release, uniqueness, primary actions and
platform distinctions. Browser verification also executes the fixed EJS
versions' standard GamepadHandler, control-slot filtering and touch handlers,
including touchcancel. Product input checks must use the actual selected
Provider module and native core, not just a settings-array assertion.

Sources: fixed fork input descriptors and implementations in the Provider
source catalog; [Libretro joypad definitions](https://github.com/libretro/libretro-common/blob/master/include/libretro.h),
[FreeIntv controls](https://github.com/libretro/FreeIntv#retropad-mapping),
[Fuse controls](https://docs.libretro.com/library/fuse/#controllers-usage).
