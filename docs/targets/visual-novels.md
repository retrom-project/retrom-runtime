# ONScripter, KiriKiri and TyranoScript

| Platform / core | Target | Input | Runtime requirements |
| --- | --- | --- | --- |
| `ons` / `onscripter_yuri` | `onscripter-yuri` | `ONS_PROJECT`, delivered as a file tree | Same-origin Wasm runtime |
| `kirikiri` / `kirikiri2` | `kirikiri2-kag` | `KIRIKIRI_PROJECT`, delivered as a file tree | Threaded Wasm and cross-origin isolation |
| `tyranoscript` / `tyranoscript` | `tyranoscript` | `TYRANOSCRIPT_PROJECT`, delivered as isolated web content | Isolated game origin and content bridge |

Keep the selected project's script/archive and referenced images, audio and other assets together. All three Targets use managed Content I/O with on-demand loading and explicit full preload. [SiglusEngine](siglus.md) is a separate integration with its own format and browser requirements.

## ONScripter Yuri

Configuration selects a real `nscript.dat`, `nscr_sec.dat`, `0.txt` or `00.txt` entry. The Target requires an explicit `scriptEncoding` of `gbk`, `sjis` or `utf8`; the host passes runtime-generated options without duplicating encoding rules. Configuration detects it from the script the engine actually reads in the entry directory (`0.txt`, `00.txt`, `nscr_sec.dat`, then `nscript.dat`): the host supplies at most the first 1 MiB of each such script as bounded evidence, the runtime removes the file's obfuscation and chooses UTF-8 when the text decodes cleanly, otherwise GBK or Shift_JIS by decoding errors and kana frequency. Existing games keep their stored option until their content is replaced. The core reads project files by byte range through shared Content I/O (`ons-content-io-v1`): opening a large archive such as `arc.nsa` fetches only the ranges the engine reads, and the second launch reuses the cached blocks. Native media playback retains its own browser boundary.

The Target declares `INSTANT` saves. Host capture is available at a stable native dialogue wait with fully drawn text/background, outside menus, transitions, skip and automatic playback. A busy native state reports unavailable instead of exporting an earlier in-game slot. Restoration retains the native script continuation; use the ordinary checkpoint-availability API rather than guessing readiness from a screenshot.

## KiriKiri2 KAG

Configuration selects a `startup.tjs`, `data.xp3` or another actual `.xp3` entry. A selected archive becomes the explicit `startupXp3Path`; project resources remain relative to the selected root. This is the maintained KAG integration, not a declaration that arbitrary KiriKiri/Z, native DLL plugins or every archive protection scheme is supported.

The Target declares `INSTANT` saves through its bookmark bridge and identity-bound save bundle. Capture waits for native bookmark readiness; restore waits for native completion and renewed readiness in the new instance. Native bookmark support and a compatible project are both required.

## TyranoScript

The entry is the selected project's `index.html`. Scripts, assets and media run in the isolated game origin through the content bridge. The adapter redirects supported desktop-storage calls to the engine's own browser storage before initialization; it does not execute a desktop package or expose a general Node.js environment.

The Target declares `INSTANT` snapshot semantics. Snapshot capture and restoration use the engine bridge and stable execution points. Plugin compatibility and script behavior need per-project validation, including restoring in a different instance and continuing input.

Sources: [configuration](../../src/runtime/configure.ts), [Target options and resource preparation](../../src/runtime/prepare.ts), and the [ONS](../../src/ons/adapter.ts), [KiriKiri](../../src/kirikiri/adapter.ts) and [TyranoScript](../../src/tyranoscript/adapter.ts) adapters.
