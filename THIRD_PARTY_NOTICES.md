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

The TyranoScript engine itself is supplied by each game project and is not included in this aggregate release.
Only the independently authored Retrom host bridge and its MIT license are aggregated from the maintained fork.

The exact repository, release tag, commit and adapter ABI used by a release are recorded in
`runtime-manifest.json`. GitHub source archives for those immutable commits and the build workflows in the
maintained forks are the corresponding source and build entry points. Applications redistributing a release remain
responsible for complying with the licenses that apply to their distribution.
