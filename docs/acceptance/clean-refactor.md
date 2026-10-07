# Clean refactor acceptance

## R15 release audit

The [release-readiness audit](release-readiness.json) supersedes the historical counts below for release decisions. Stable runtime/Retrom publication remains incomplete. Five current-fingerprint scene proofs have been reconciled (NES, MV, MZ, TyranoScript and J2ME); VecX and OpenBOR remain scoped partial observations, ten rows lack complete material, and the other rows still require current-identity semantic closure. No historical PASS is automatically promoted.

The ONS and VecX fixes have been merged and their immutable core releases published. ONS r6 uses different JS/Wasm bytes from the local candidate and requires product retesting. VecX r2 has different archive bytes but identical unpacked execution files; its final fingerprint must still be reconciled after preparation. The source pins and CI now consume those published assets without unpublished ONS transport.

## Historical R10 snapshot

All identities and counts in the remaining sections describe the captured R10 checkpoint, including uses of “current” inside that historical record. They are not the R15 release state.

This unpublished work is based on runtime commit `745d9ecabc7bdd0e934e1c69737399ebe6deef9b`. The retained denominator is 110 Provider Targets, 109 prior host bindings, 95 platforms and 122 platform/content rows. EmulatorJS PPSSPP remains declared without a prior product entry. No tags, production locks, ROMs or BIOS files were published or committed. The only rebuilt core in that snapshot is ONScripter Yuri, whose sampled checkpoint defects required a separately verified native fix.

## Installed candidate and identity

The current `current-wait-model-r10-final` Provider and self-contained host tool capture source `a8c47231ec7757e195f743538a8397e0097f709ef6f875e54a9912f6c8bd57cf`. Later acceptance-document edits do not alter that captured source. Standard PFB development uses source Go/Next and the ordinary Provider watcher; its native loose module is recorded separately from the formal client.

| Provider | Bundle SHA-256 | Formal client SHA-256 |
| --- | --- | --- |
| emulatorjs | `04db7ce9f44eba06f3dc1f1f560254128da842e3a1694b4dc0f127d607ddd674` | `06d8bb65194ac342a2e7cce6bdef4cdf5d2bf3f31592389ac8b49c7b468bb370` |
| retrom-runtime | `378451347ca8e8dcbff0e08cf0af684c6806a61253eddd95d8e4deb6612ff941` | `f30d6218bb09a13d43232c298f94a4a6f60653b727e4b77c5b457fedd3732c35` |

The actual development native module is `8a836d55af66308661bafecfe618727a638360b04fccab83a77844bba40f8cba`, 516,298 bytes. All 35 selected native fingerprints match the formal base. The host-tool archive is 9,457,944 bytes, SHA `4ccd8d987e75ec03f21eb973274d3a7ea417c827882af225d6f8ed4029c00286`, installed revision `5ee09e59305841c8636ced2fc38fe348a79dc5470f6cc732bdcca78e0af63334`. Standard initialization registered the ONS source inside the same PFB, imported verified bytes and ran the normal build/up/watch workflow. Installation did not rebuild the core.

The exact change against R7 is all 75 EmulatorJS fingerprints and only ONS among 35 native fingerprints; the other 34 native fingerprints remain identical. Removing the old cross-core helper that inferred Thomson model from editable presentation title changes the real selected execution closures. Old saves retain their original identities and become CORE_CHANGED where appropriate. No old hash, migration or compatibility branch was added. Actual build regressions prove later DOS-only, Lutro-only and Thomson-only changes affect their own selected closures and leave unrelated cores unchanged. A final host-only MAME rule fix changed neither client nor any of the 110 fingerprints.

## Runtime and core correctness

Runtime configuration interpretation, full active-file ROM identity, selected options, content dependencies and firmware facts have one runtime implementation. The host consumes its catalog and preparation output without engine branches. Single-file content uses its original SHA; project content hashes the complete logical path/size/SHA tree, including a one-file project. All configured core option entries are validated. Parent ZIPs remain intact where the core requires the parent archive, and single-disc CUE references retain their actual entry format and tracks. Discovery lets the host copy safe dependencies from its restricted source root; no multi-disc switching remains.

Preparation accepts the existing frozen save context. It first verifies original allowed core, Provider/Target, implementation fingerprint, complete ROM hash and readable checkpoint format, then validates and applies the original content/options. A same-byte single-file rename maps to the current managed file without overwriting frozen machine options. Explicit MAME machine names remain authoritative and mount the current ZIP at that machine's native filename. DOS menu versus explicit program selection and ScummVM configuration follow the same frozen-context path. The host passes Save.extinfo and preserves the four restore-conflict codes; it does not interpret cores.

Thomson now has a declared model option. Automatic model selection reproduces the pinned core's ordered filename rules and default TO8 at initial preparation, then freezes the effective explicit model in runtime options. Game JSON and editable display title do not change. Restore uses the saved model even if current model or same-byte file name changes. Actual packaged preparation against managed Thomson and DOS content verifies ordinary-current versus saved-context differences. This validates configuration identity; the separately observed native boot/gameplay remains product evidence.

ONS now declares true stable default or custom text-gosub waits as checkpoint-ready. Menu, typewriter and transition states report BUSY. Native saving checks readiness again atomically and serializes the actual current wait rather than an earlier native user-slot savepoint. Its bounded tail includes text offset, current page, font position and custom call stack. Actual read length bounds parsing, rather than allocation capacity. Host serialization has a separate buffer and leaves ordinary native user-slot semantics unchanged.

Canonical ONS browser tests cover third wait → fresh instance at third → ordinary fourth, custom UTF8 text-gosub, ordinary FIRST user slot coexisting with host THIRD, a previously larger read buffer followed by a shorter checkpoint, truncated tails and atomic not-ready rejection. Custom continuation retains every glyph and location; 528 text-edge pixels differ by at most 2 channel units, with exact backdrop pixels. No SDL presentation patch or test-only production hook was added.

The native candidate captures source `8cc91bda2853ad2d716e39c2aa894f5bf625668e8cf847f9668243c99ee78a19` from base `1ec932b08f5d8efb9bbd1ca6350f9ada1cfba00c`. Its JS SHA is `cca7513fbf06f09afd11ecd05f55a2520dde9c700decd0fa06c037d45c7ee5ee` and WASM SHA is `efa139e769f5a67abdf160955178590ae804ac82da098c6f2f38f714845be6a4`. Only these ONS execution bytes changed; other core assets match the verified base. Canonical build provenance, license and browser CI remain owned by the separate core repository.

Final source delivery commits ONS locally at `6faf28767e1800f591f97be9e7baa3c0da53b2c9`. The standard candidate command from that clean commit generates source digest `172d894c19f0fc6d298c75d6bd7df25b25986c36e0d0a0208268200f7999fe1d` and `dirty: false`; JS, WASM and license remain byte-identical to the tested R10 candidate. The immutable 1,838,755-byte ZIP is SHA `81526b8dbce1b53fbd2229ae6cb482d7c7ed77aa06d6758e930b90fdb60f72e3`, now declared in `provider-sources.json`. The old descriptor is retained unchanged as historical evidence.

## Quality gates

R10's complete runtime suite passed 1,505 tests in 282 files, with no failures and unchanged assertions/deadlines. The subsequent paired-input implementation passed 1,518 tests in 284 files; lint, strict types, build, package closure and source diff-check passed. Package verification checks 1,193 files, 23 pinned published inputs and one immutable ONS candidate input, 110 Targets, 109 bindings and 95 platforms. A fresh independent extraction has no external symlinks or checkout dependencies and executes catalog, configure, normalize-content, prepare including frozen rename, and the actual native ScummVM detector. JSONL process reuse remains serial and bounded per worker; it adds no public service, persistent queue or authorization state.

The [quality evidence](runtime-quality-evidence.json) retains exact final log hashes alongside historical candidate and failed-attempt records. The normal commands are:

```bash
npm run lint
npm run typecheck
npm run build
npm test -- --maxWorkers=4 --reporter=dot
RETROM_PACKAGE_DETECTOR_PROVIDER_ROOT=<verified-native-provider> \
RETROM_PACKAGE_DETECTOR_TREE_ROOT=<read-only-actual-project> npm run package:check
python3 <workspace>/.codex/skills/breaking-change-refactor/scripts/check_protocol_generations.py \
  --repo . --base 745d9ecabc7bdd0e934e1c69737399ebe6deef9b
```

Earlier enum-order/golden/unbuilt-dist and detector-input failures were corrected before the complete final green suite. A historical 256 MiB compression timeout under simultaneous builds/browser load remains recorded; the final complete suite passed without weakening its deadline.

## Product evidence and limits

The [matrix](runtime-product-matrix.json) keeps historical semantic proofs, exact tested fingerprints and present-identity status separately. It currently records 73 scoped semantic rows at some tested fingerprint, 112 actually attempted rows and 10 genuine material gaps. All available-material rows have been attempted. Of those semantic rows, 30 retain the current fingerprint, including current R10 NES, ONS, three scoped NDS registration tests, Thomson and GAM4980; 43 prior EmulatorJS successes require new-fingerprint semantic retests. Unchanged native proofs retain their exact implementation identity without pretending they were rerun in R10.

The current bounded EmulatorJS sweep exercised 79 rows over 68 Targets: 78 visible-canvas/enabled-Pause startup observations and one original-core Parallel N64 memory-OOB failure after correcting the pending-game route. These observations are startup evidence, not gameplay, screenshot fidelity or save/restore passes. Opera records one `unreachable` near the exit boundary and is not labeled error-free. Thomson is exercised separately.

Current DeSmuME, DeSmuME2015 and melonDS evidence covers ordinary held pointer input, actual registration data and a different Run restoring the registration scene before continued normal input. Seven-second equality is publicly paused. These are scoped scene-state successes, not completed registration, daily stories or an all-games touch-input assertion.

The current NES regression uses the owned MIT ROM on desktop and mobile: genuine keyboard changes tagged P1 RAM, a new Save restores the exact value in a different Run, further input changes it and remains stable seven seconds. Ordinary Pause and CAS behavior are separately checked. Its proof is `frontend/hud-handle-r10/nes-semantic-proof.json`, SHA `7b2324762822ba6374e49c0f7b6de65a5ab6312a0306120301e74de0506a92c4`.

Thomson's original author disk is loaded through normal TO8D BASIC commands and AZERTY keys. Played snake position and score are saved; a storage-empty fresh browser restores using frozen TO8D while current Game configuration is TO7. Seven publicly paused seconds are exact, then normal input advances position and score. The proof is `root/interactive/theodore-played-cold-context-r10/semantic-proof.json`, SHA `1f7911f89523a717223efc58167b5c1e6ec6546ee8c978f1f2fc81db2e65c573`. GAM4980 similarly restores a noninitial landed-piece grid in a fresh browser before normal input adds a new stack; its proof is `root/interactive/gam4980-cold-played-r10/semantic-proof.json`, SHA `8ccd2d4fc19ba3fd739d89c168ee8f3ef5099edbe6d9a8dcf5785ec4b30df7cc`. Initial wrong-key/menu exploration and an unstacked ErrnoError remain historical observations, separate from that successful cold chain.

The actual ONS product uses normal UI Save at the third text wait and a public screenshot. A completely fresh browser/context restores the 633-byte payload through HTTP with its exact SHA/strong ETag. The original third dialogue and full white backdrop remain for seven seconds; ordinary clicking advances to the fourth sentence while both earlier lines remain. Backdrop pixels are exact; 3,100 text-edge pixels differ by at most 3 channel units, so whole-canvas bit equality is not claimed. Title readiness correctly leaves Save disabled. Both Runs close 204 with stable main/native time origins. The proof is `runtime/interactive/ons-current-wait-cold-r10/semantic-proof.json`, SHA `b3a81a4d389a8e8981a30bc2e5f81528ccd365c0f9f3c08cb1c4c769e210c418`. Auxiliary premature-canvas, wrong optional GET method, CSP diagnostic image decoding and non-browser transport mistakes remain explicitly separated from successful product delivery.

Native MV/MZ, Tyrano, Flash, Lutro, ScummVM, EasyRPG, XP/VX/VX Ace, WebMSX and other matrix proofs state their own scope. Actual script/import/Worker/media, original frozen drafts after Redis loss, delayed A/B acknowledgement, different-Run restoration and continued ordinary input are evidenced where tested. Apple2JS input uses an explicitly synthetic standard browser Gamepad API, not a verified physical USB controller. Butterscotch proves room/position, without asserting unobserved global player-name fidelity. KAG's public template passes, while the operator KiriKiri project remains a black-screen compatibility case.

## Unclosed observations

- Original pinned MAME2003/Plus bytes reproduce sampled restore/render limitations without Retrom. Parallel N64 reproduces memory-OOB without the host and in the current product. These are sample-scoped observations, not universal claims about every game.
- VecX original fixed-byte minimal input/checkpoint/fresh-instance restoration and current UI save/different-Run/input do not reproduce the historical null-function. Immediate public pause after restoration leaves parts of the vector scene undrawn; full player/scene semantics remain unestablished. The comparison is `runtime/interactive/vecx-current-product-r10/boundary-proof.json`. PS2 has actual product GL warnings/cinematics and successful independent full-Provider rendering; a permanent generic host/core failure is not established.
- OpenBOR's observed first level has native saving disabled; no real game-progress file was written. J2ME's initialization RMS and SAM's unchanged disk do not qualify as game-progress restoration.
- J2ME's later normal training/menu observation and read-only original JAR inspection distinguish three-byte options from five-slot game-progress records. Its five Continue slots remain empty; the 349-byte initialization bundle is not a progress proof. Sixteen Next building/RSC/built observations retain stable main/native time origins and are not described as zero HMR.
- Early GB/GBC blue-dialogue or pause-caption rendering, immediate post-restore black frames and first-page Next development refresh interruptions remain attached to their exact proofs. Later successful stable scenes do not erase those limited observations.
- Material gaps remain for complete Daphne projects, Atomiswave/Naomi/Naomi2, Amiga CD32, Satellaview, Model3 and some native Apple/MAME firmware-platform inputs. No blank canvas, unrelated game or fabricated ROM header substitutes for a missing material row.

Historical artifact identities and observations remain in the quality record and each matrix row. Successful component tests, verified archives and HTTP transport do not establish full-platform product acceptance.

## Unpublished delivery and formal release boundary

The last game acceptance above uses R10's local descriptor, `source: candidate` and `release: null`. Its `0.59.1` Provider label is inherited from the verified imported base; these bytes do not replace the official `v0.59.1` archives. Final delivery builds after the source/documentation freeze emit one external `runtime-inputs.json` with actual source-tree SHA and three verified archive identities. Later packaging changes do not relabel historical gameplay as a new test. The final descriptor and zero-client/core/fingerprint comparison belong to external build evidence, avoiding a document/source-hash cycle.

The old ONS r4 declaration has been removed. The existing development-input contract now pins the tested candidate ZIP by size, archive SHA and original compiled-source digest. Its descriptor and JS/WASM files are verified before staging; the JS checkpoint-ready binding must resolve to an actual WASM function. A normal build without explicit candidate mode fails `UNPUBLISHED_CORE_INPUT`. CI first prepares the declared hash-pinned ZIP and fails `CORE_CANDIDATE_TRANSPORT_REQUIRED` when transport is absent. Local preparation is documented in [README](../../README.md). No mutable transport variable decides source or hashes, and no other checkout is a build dependency.

Formal closure requires a new immutable ONS core release and corresponding source pin, then a new annotated runtime release tag publishing both Providers, the host-tool archive and `runtime-inputs.json`, followed by the host's new paired pin. `scripts/build-release.mjs` and the release workflow validate the tag/commit identity. No old tag, archive or production release pin was altered, and no protocol generation change is required. R10's original compiled-source descriptor remains historical evidence. Final input preparation generates a new descriptor through the standard candidate command from a clean local core commit and verifies identical JS/WASM bytes; it never edits the old descriptor's source or dirty fields.
