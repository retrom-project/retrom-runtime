# Third-party components

Release archives aggregate the following independently licensed components:

- EasyRPG Player — GPL-3.0-or-later — <https://github.com/retrom-project/Player>
- liblcf — MIT — <https://github.com/EasyRPG/liblcf>
- mkxp-z — GPL-2.0-or-later — <https://github.com/retrom-project/mkxp-z-libretro-emscripten>
- RetroArch — GPL-3.0-or-later — <https://github.com/libretro/RetroArch>
- Nostalgist — MIT — <https://github.com/arianrhodsandlot/nostalgist>
- fflate — MIT — <https://github.com/101arrowz/fflate>
- ONScripterYuri — GPL-2.0-or-later — <https://github.com/retrom-project/OnscripterYuri>
- Kirikiroid2 Web — GPL-3.0-only — <https://github.com/retrom-project/kirikiroid2-web>
- Butterscotch — AGPL-3.0-only — <https://github.com/retrom-project/Butterscotch>
- Retrom TyranoScript host bridge — MIT — <https://github.com/retrom-project/tyranoscript>
- J2ME Web — includes miniJVM (MIT/GPL-2.0), FreeJ2ME Plus (GPL-3.0-or-later), FFmpeg (LGPL-2.1-or-later),
  and the components detailed in the bundled `licenses/j2me/THIRD_PARTY_NOTICES.md`. The FreeJ2ME miniJVM
  adapter has no explicit upstream license; the upstream notice retains that redistribution limitation.
- TIC-80 — MIT — <https://github.com/retrom-project/TIC-80>; bundled `licenses/tic80/LICENSES.txt` contains upstream and dependency license texts.
- FAKE-08 — MIT — <https://github.com/retrom-project/fake-08>; bundled `licenses/fake08/LICENSES.txt` includes z8lua/Eris and other dependency notices.
- WASM-4 — ISC — <https://github.com/retrom-project/wasm4>
- ScummVM — GPL-3.0-or-later — <https://github.com/retrom-project/scummvm>; bundled
  `licenses/scummvm/COPYING`, `COPYRIGHT`, `AUTHORS` and component license texts accompany the
  engine plugins, support data and native detector. `licenses/scummvm/build-inputs.json` pins the
  upstream commit, SDK and supporting libraries used by the maintained fork build.

The TyranoScript engine itself is supplied by each game project and is not included in this aggregate release.
Only the independently authored Retrom host bridge and its MIT license are aggregated from the maintained fork.

The exact repository, release tag, commit and upstream asset used by a release are recorded in
`provider-sources.json` and the generated Provider Bundle provenance. Target behavior, checkpoint formats and
runtime files are recorded by the generated Provider declaration. GitHub source archives for those immutable
commits and the build workflows in the maintained forks are the corresponding source and build entry points.
Applications redistributing a release remain responsible for complying with the applicable licenses.

## Play!

Source: https://github.com/retrom-project/Play- (upstream https://github.com/jpd002/Play-),
base commit `83700b2c31e593bc94e845b4b31b797be84dda59`. Play! uses the BSD 2-Clause license.
The fork supplies its license and linked dependency notices with release artifacts;
the Provider preserves them at `licenses/play/LICENSE`. No game or BIOS is bundled.

## NP2kai (PFB candidate)

Source: https://github.com/retrom-project/NP2kai, upstream AZO234/NP2kai commit
`5939e0c6d5985c4c08fc70f289a83290e5d3e6f7`. NP2kai includes MIT/BSD code and components
with additional licenses, including the GPL DOSBox FPU implementation. The fork's generated
`licenses/np2kai/LICENSE` preserves its upstream LICENSES collection, SDL2, libpng, zlib
and the pinned np2-wasm 0.3.1 Shinonome font notice. The corresponding source and build
entry point remain in the fork; no game or proprietary BIOS image is distributed here.
