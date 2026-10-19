# Target guides

Use the generated [support catalog](../supported-platforms-and-cores.md) to find the exact `platformId`, `coreId`, `providerId` and `targetId`. These guides explain content preparation, browser requirements and restrictions for those integrations. An upstream core's extension list or a declared Target does not establish compatibility with every game.

## Shared rules

- Use the selected Target's capabilities and checkpoint declaration. `INSTANT` restores execution state, `GAME_SAVE` transfers native game data, and `NO_SAVE` offers no checkpoint. The public Provider boundary applies one gzip layer; adapter-native format names are not public storage formats.
- Range-based integrations use shared [Content I/O](../content-io.md). Native read sizes, cache blocks and HTTP fetch windows are different boundaries. Fetches may be coalesced or prefetched; ordinary on-demand loading and explicitly requested full preload have different transfer behavior.
- Supply firmware and dependencies from the runtime preparation result. Different cores for the same platform can require different firmware or DAT versions. Games and user-supplied firmware are not included in Provider releases.
- For current source tags, commits and asset checksums, use [provider-sources.json](../../provider-sources.json) and the [EmulatorJS source catalog](../../src/providers/emulatorjs/source-catalog.ts). Release aggregation and local candidate workflows are described in [Development and releases](../development.md).
- Follow [Provider integration](../provider-module-v1.md) for lifecycle and save APIs and [input mapping](../input-mapping.md) for shared controller conventions. Product acceptance records retain the exact game, build and tested scope separately.

## EmulatorJS

The [general EmulatorJS guide](emulatorjs-single-file.md) covers ordinary cartridge, computer and single-disc Targets. The following guides describe integrations with additional requirements:

| Guide | Targets or content |
| --- | --- |
| [Arcade sets](arcade.md) | FBNeo, FBAlpha, FBA2012 CPS1/CPS2, MAME2003/Plus and native MAME Current |
| [DOSBox Pure](dos.md) | `dosbox-pure` |
| [Dreamcast](dreamcast.md) / [Flycast arcade](flycast-arcade.md) | `flycast`, `flycast-naomi`, `flycast-naomi2`, `flycast-atomiswave` |
| [Daphne](daphne.md) | `daphne`, `NO_SAVE` |
| [NeoCD](neocd.md) | `neocd` |
| [SNES / bsnes](emulatorjs-bsnes.md) | `bsnes` |
| [Intellivision](intellivision.md) | `freeintv` |
| [PC-88](pc88-quasi88.md) | `quasi88` |
| [Uzebox](uzebox.md) | `uzem` |
| [Fantasy consoles and Lutro](tic80-fake08.md) | `lutro` and the native fantasy Targets below |
| [EmulatorJS PSP](emulatorjs-psp.md) | Declared `emulatorjs/ppsspp`, without a product binding |

## Independent Web/Wasm runtimes

| Guide | Targets in the `retrom-runtime` Provider |
| --- | --- |
| [RPG Maker](rpgmaker.md) | `rpgmaker-2000`, `rpgmaker-2003`, `rpgmaker-xp`, `rpgmaker-vx`, `rpgmaker-vx-ace`, `rpgmaker-mv`, `rpgmaker-mz` |
| [MV desktop plugin boundary](rpgmaker-mv.md) | Additional behavior for `rpgmaker-mv` |
| [Visual novel engines](visual-novels.md) | `onscripter-yuri`, `kirikiri2-kag`, `tyranoscript` |
| [SiglusEngine](siglus.md) | `siglus` |
| [GameMaker / Butterscotch](gamemaker.md) | `butterscotch-gamemaker` |
| [JavaScript computer emulators](computer-runtimes.md) | `apple2-apple2js`, `bbc-jsbeeb`, `samcoupe` |
| [MAME machine families](mame-apple2.md) | `mame-apple2`, `mame-apple2e`, `mame-atom`, `mame-pv1000`, `mame-sg1000`, `mame-coleco` |
| [Arcade sets](arcade.md) | `mame-arcade` |
| [MSX](msx-webmsx.md) | `msx-webmsx` |
| [PC-98](np2kai-pc98.md) | `np2kai-pc98` |
| [Sharp X68000](px68k.md) | `px68k` |
| [PSP / PPSSPP](ppsspp.md) | `ppsspp` |
| [Play! PS2](play-ps2.md) | `play-ps2` |
| [ScummVM](scummvm.md) | `scummvm` |
| [Flash](flash-ruffle.md) | `flash-ruffle` |
| [Java ME](j2me.md) | `j2me` |
| [Pokémon Mini](gbe-pokemini.md) | `gbe-pokemini` |
| [Cave Story](nxengine.md) | `nxengine` |
| [OpenBOR](openbor.md) | `openbor` |
| [Fantasy consoles](tic80-fake08.md) | `tic80`, `fake08`, `wasm4` |
