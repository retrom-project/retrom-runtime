# Standard gamepad and touch input

Browser standard buttons 0/1/2/3 are bottom/right/left/top (Xbox A/B/X/Y,
PlayStation Cross/Circle/Square/Triangle). Libretro slots B=0, A=8, Y=1 and
X=9 describe RetroPad positions. Core actions must be checked separately;
Nintendo letters, Sony positions and Sega A/B/C are different conventions.
Every physical button has one native destination. Keyboard bindings stay
independent. The host does not remap core inputs.

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
