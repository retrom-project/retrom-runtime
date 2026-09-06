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
- WASM-4 — ISC — <https://github.com/retrom-project/wasm4>

The TyranoScript engine itself is supplied by each game project and is not included in this aggregate release.
Only the independently authored Retrom host bridge and its MIT license are aggregated from the maintained fork.

The exact repository, release tag, commit and upstream asset used by a release are recorded in
`provider-sources.json` and the generated Provider Bundle provenance. Target behavior, checkpoint formats and
runtime files are recorded by the generated Provider declaration. GitHub source archives for those immutable
commits and the build workflows in the maintained forks are the corresponding source and build entry points.
Applications redistributing a release remain responsible for complying with the applicable licenses.
