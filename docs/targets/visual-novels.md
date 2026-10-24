# ONScripter, KiriKiri and TyranoScript

| Platform / core | Target | Input | Runtime requirements |
| --- | --- | --- | --- |
| `ons` / `onscripter_yuri` | `onscripter-yuri` | `ONS_PROJECT`, delivered as a file tree | Same-origin Wasm runtime |
| `kirikiri` / `kirikiri2` | `kirikiri2-kag` | `KIRIKIRI_PROJECT`, delivered as a file tree | Threaded Wasm and cross-origin isolation |
| `tyranoscript` / `tyranoscript` | `tyranoscript` | `TYRANOSCRIPT_PROJECT`, delivered as isolated web content | Isolated game origin and content bridge |

Keep the selected project's script/archive and referenced images, audio and other assets together. All three Targets use managed Content I/O with on-demand loading and explicit full preload. [SiglusEngine](siglus.md) is a separate integration with its own format and browser requirements.

## ONScripter Yuri

Configuration selects a real `nscript.dat`, `nscr_sec.dat`, `0.txt` or `00.txt` entry. The Target requires an explicit `scriptEncoding` of `gbk`, `sjis` or `utf8`; the host passes runtime-generated options without duplicating encoding rules. Configuration detects it from the script the engine actually reads in the entry directory (`0.txt`, `00.txt`, `nscr_sec.dat`, then `nscript.dat`): the host supplies at most the first 1 MiB of each such script as bounded evidence, the runtime removes the file's obfuscation and chooses UTF-8 when the text decodes cleanly, otherwise GBK or Shift_JIS by decoding errors and kana frequency. Existing games keep their stored option until their content is replaced. The core reads project files by byte range through shared Content I/O (`ons-content-io-v1`): opening a large archive such as `arc.nsa` fetches only the ranges the engine reads, and the second launch reuses the cached blocks. Native media playback retains its own browser boundary. Empty auxiliary files, including version markers, remain in the project tree with size zero and do not prevent startup.

The Target declares `INSTANT` saves. Host capture is available at a stable native dialogue wait with fully drawn text/background, outside menus, transitions, skip and automatic playback. A busy native state reports unavailable instead of exporting an earlier in-game slot. Restoration retains the native script continuation; use the ordinary checkpoint-availability API rather than guessing readiness from a screenshot.

## KiriKiri2 KAG

Configuration selects a `startup.tjs`, `data.xp3` or another actual `.xp3` entry. Bounded XP3 header evidence also identifies archives with other suffixes. An enclosing canonical entry takes precedence over a nested copy; peer projects require an explicit selection. A selected archive becomes `startupXp3Path` regardless of its suffix; a loose root `startup.tjs` starts its directory. Project resources remain relative to the selected root. The saved launch options and checkpoint format remain unchanged.

Host import normalization can convert verified CxFilterFS `eliF`/`hnfn`/`Yuzu`/`sen:` variants into ordinary XP3 before configuration. Names and optional salts come from the archive; supported Tiny/classic Cx parameters come from static PE data/code relationships in supplied EXE/DLL/TPM files. These files are never executed. Successful normalization preserves archive layering and returns new immutable content facts; source metadata anomalies are explicit diagnostic details, not complete-source integrity passes. Ordinary XP3 is retained unchanged. Hxv4 name recovery remains unsupported and fails import explicitly. Missing parameters, extra content filters or ambiguous profiles also fail; titles do not select conversion rules. See [normalization contract](../runtime-module.md).

The Kiri file tree preserves exact paths, including names that differ only in case. Its virtual filesystem enumerates both names and resolves an exact name first; a case-folded alias is usable only when it is unique. Other Targets retain their explicitly declared folded uniqueness requirements. A Wasm trap, abort or nonzero process exit reports a fatal failure and closes the session; only a zero process exit requests normal exit. Native script exceptions still require a reliable core error boundary and cannot be inferred from localized alert text.

This is the maintained KAG integration. Arbitrary KiriKiri/Z, native DLL plugins and archive protection schemes require their own verified support.

Disc dependency discovery follows the selected single-file Target's declared formats. Incidental CUE files in project content stay opaque. Disc CUE parsing accepts explicit Unicode BOMs or strict UTF-8; legacy Shift-JIS/GB18030 candidates must agree on references or resolve uniquely against actual tracks. Ambiguous missing legacy names fail with `RUNTIME_CUE_ENCODING_REQUIRED`.

The Target declares `INSTANT` saves through its bookmark bridge and identity-bound save bundle. Capture waits for native bookmark readiness; restore waits for native completion and renewed readiness in the new instance. Native bookmark support and a compatible project are both required.

## TyranoScript

The entry is the selected project's `index.html`. Scripts, assets and media run in the isolated game origin through the content bridge. The adapter redirects supported desktop-storage calls to the engine's own browser storage before initialization; it does not execute a desktop package or expose a general Node.js environment.

The Target declares `INSTANT` snapshot semantics. Snapshot capture and restoration use the engine bridge and stable execution points. Plugin compatibility and script behavior need per-project validation, including restoring in a different instance and continuing input.

Sources: [configuration](../../src/runtime/configure.ts), [Target options and resource preparation](../../src/runtime/prepare.ts), and the [ONS](../../src/ons/adapter.ts), [KiriKiri](../../src/kirikiri/adapter.ts) and [TyranoScript](../../src/tyranoscript/adapter.ts) adapters.
