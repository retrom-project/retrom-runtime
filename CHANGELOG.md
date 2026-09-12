# Changelog

## 0.37.0

- Add the GBE+ Pokémon Mini target with required BIOS, standard gamepad controls, verified persistent content caching and the shared compressed instant checkpoint contract. Pin the immutable GBE+ core release and verify its complete asset inventory and byte hashes.
- Refresh the aggregate license notice carried by EmulatorJS Provider 2.14.0; its core payloads and target behavior are unchanged from the preceding release.

## 0.36.0

- Add the NeoCD single-CHD target in EmulatorJS Provider 2.13.0, pinned to the immutable NeoCD fork release. The maintained fork owns the WASM build.
- Map NeoCD native A/B/C/D to the standard bottom/right/left/top face buttons, without binding native multi-button shoulder macros.
- Load NeoCD through bounded, persistent Range blocks and an Asyncify core bridge, without a startup whole-disc download or hash scan; retain Flycast OPFS behavior. Preserve native load skipping and compressed instant checkpoints.

## 0.35.0

- Add an independent bsnes Target to EmulatorJS Provider 2.12.0 using the
  pinned 4.3.0-pre frontend and an immutable bsnes fork release. The fork restores
  Asyncify and fiber lifecycle support, and fixes native save completion and
  heap ownership. The target uses standard SNES controls and the distinct
  `bsnes-state-v1-storage-v1` checkpoint format; it rejects generic EmulatorJS
  snapshots to prevent mixing bsnes and Snes9x states. Snes9x and netplay
  profiles remain unchanged.

## 0.34.0

- Add the PC-88 QUASI88 target in EmulatorJS Provider 2.11.0, pinned to the immutable core fork release. D88/U88 launches use N88 V2, independent keyboard input, one-to-one standard gamepad controls and the shared compressed instant checkpoint contract.

## 0.33.0

- Add the Intellivision `freeintv` target from EmulatorJS 4.3.0-pre with standard gamepad and instant checkpoint support (EmulatorJS Provider 2.10.0).
- Resolve FreeIntv's report cache-busting request to its pinned bundle asset, preserving unrelated requests and fetch cleanup.

## 0.32.0

- Add the EmulatorJS `vecx` target for Vectrex cartridges.
- Publish EmulatorJS Provider 2.9.0 with the immutable VecX fork release, complete native checkpoints, and standard four-button input.
- Keep unpublished core inputs rejected by formal Provider builds.

## 0.31.0

- Correct EmulatorJS core framebuffer screenshots to the reported display aspect ratio before returning them to the host. This prevents non-square pixel output such as CD-i 768×280 from producing vertically flattened save and review thumbnails; native pixels remain uncropped.

- Publish EmulatorJS Provider 2.8.0 with pinned core fork releases. Backport CDIC disc startup and sound-map restart timing fixes to remove periodic audio interruptions in Nobelia Demo 1 after fresh boot. PAL remains 50 Hz; existing state fields are unchanged. Old checkpoints may preserve the interrupted guest audio driver until a new stream starts.

- Configure SAME CD-i digital pointer increments to 20 before native startup, preserving its button mappings and mouse sensitivity. This fixes right/down movement being filtered out by games such as Nobelia, including after fresh-launch checkpoint restoration. PAL timing remains 50 Hz.

- CrocoDS dismisses its autorun menu after restore, and EightyOne preserves controller port selections while loading content and queries base input devices. EightyOne pins its controller devices through RetroArch command-line overrides so remapping cannot reset them. PET routes the first RetroPad to its actual user-port joystick instead of an absent built-in port. PET and Plus/4 reopen audio after fresh-instance state restoration; Plus/4 reconstructs the TED display bounds and cursor. Home computer defaults enable independent keyboard input; PET uses a 40-column 4032 with its joystick adapter, and Plus/4 uses joystick port 1.

- Add EmulatorJS targets for EightyOne, Caprice32, CrocoDS, VICE PET, Plus/4, C64 and SAME CD-i, using pinned 4.2.3 assets.
- Use the shared compressed checkpoint write contract, retain legacy raw checkpoint reads and preserve the single-file input policy for these targets.
- Preserve Caprice32 DSK input instead of letting EmulatorJS synthesize an unsupported CD cue for a core advertising M3U support.
- Keep original/pixel output on an explicit, unfiltered passthrough shader. EmulatorJS 4.2.3's disabled-shader fallback can display solid colors or cropped output after native video geometry changes.

## 0.30.0

- Add the PC-98 NP2kai target with the pinned r1 core, HDI/D88 input, verified persistent disk cache, download progress and instant machine/disk checkpoints.
- Compress every new checkpoint exactly once at the shared Provider boundary, without a size threshold; decode before restore and persistence acknowledgement, including final native-save snapshots.
- Advance EmulatorJS Provider to 2.7.0. Version all storage write formats while retaining legacy raw, PSP/Flycast gzip, mkxp compact and PX68K deflate ZIP reads. New PX68K ZIP entries use STORE and private transport compression writers are removed.
- Enable PSP native load receipts for explicit restore, and suppress its upstream reboot during explicit exit while retaining native cleanup.

## 0.29.0

- Add OpenBOR PAK content through a fork-owned Emscripten/SDL2 core and the
  `openbor-host-v1` interface. Formal builds pin the independent maintained core
  release `retrom-core-g9d81480f8481-r1`; local source-bound overrides remain
  restricted to explicit PFB builds.
- Bind native progress files to the game digest in `openbor-game-save-v1`
  (`GAME_SAVE`). Restore them before startup and continue through the game menu;
  this target does not provide instant snapshots.
- Verify bounded PAK downloads and reuse verified content chunks across Launches.
  Support standard gamepad scancodes, native keyboard input, pause and screenshots,
  and release input/audio resources when the core exits.

- Advance EmulatorJS Provider to 2.6.6 for the aggregate OpenBOR license notice;
  its core assets and behavior remain unchanged.

## 0.28.0

- Pin PX68K r1 and TyranoScript bridge r8 to immutable releases with verified asset sizes and SHA-256.
- Advance EmulatorJS Provider to 2.6.5 for the aggregate third-party notice change; its core assets and input behavior remain unchanged.

- Tyrano 旧版兼容层每个手柄按钮只投射一个键盘目标，不再同时发送 KAG/DOM 手柄事件；现代引擎保留原生手柄路径，真实键盘独立可用。
- 补齐 TyranoScript 已声明的 pixel/smooth 画面模式控制，修复宿主初始化时的能力错误。
- Tyrano 4.x 不要求新版 chara 组件，按各版本的菜单方法判断可存档状态。
- 旧版音频仅在媒体已暂停且播放请求以 AbortError 取消时正常完成；其他播放错误继续传播。

- Add the PX68K single-disk X68000 target with keyboard/gamepad, audio, pause,
  screenshots and machine/disk checkpoints across fresh launches.
- Keep PX68K gamepad and keyboard input independent: Button 1 (B) no longer
  injects Escape and pauses games; A/Start no longer inject Enter.
- Let arrow keys and Z/X operate PX68K joypad one while retaining native keyboard
  input, and release held keyboard controls on blur, pause and exit.
- Verify bounded cached game, BIOS and Wasm bytes before native construction.
- Accept descriptor-verified flat-file core candidates in PFB builds while
  keeping unpublished sources out of formal releases.

## 0.27.0

- Add the independent `msx-webmsx` Target with bounded single-media loading, persistent
  content cache, standard controller input, screenshots and pause/resume.
- Bind `webmsx-state-v1` instant snapshots to the game's content digest and restore them
  into a fresh machine. Release controller input on pause and exit.
- Pin the WebMSX maintenance release with exact commit, asset lengths and SHA-256.
  Local overrides remain restricted to explicit PFB builds. Preserve the unresolved
  upstream source and embedded system-ROM license status in the dedicated notice.

## 0.25.0

Ruffle integration: enforce centered aspect-ratio scaling and expose native data as a
`STORAGE` container through the optional public save data kind. Keep existing input mappings and
changed-data export behavior; no Mode-specific exceptions.

- Advance EmulatorJS Provider to 2.6.1 for the updated bundled third-party notices; its execution
  code and core assets remain unchanged from 2.6.0.
- Keep Ruffle's responsive canvas layout core-owned so fullscreen and viewport changes do not
  compete with the Provider's fixed-resolution fitting. Other adapters retain the default fitting.
- Add the independent `flash-ruffle` Target for bounded single-SWF content, with keyboard/mouse
  and standard gamepad input, pause, volume and screenshots.
- Transport native SharedObject bytes in `ruffle-sharedobjects-v1` (`GAME_SAVE`, 8 MiB maximum).
  Restore only explicit identity-matched payloads before movie execution; fresh Launches start empty.
- Validate SWF compressed/decompressed bounds, exact download sizes and SHA-256; reuse Cache Storage
  across different Launch URLs by content identity and report deterministic download progress.
- Pin the published Ruffle fork `retrom-core-ge46d1642fb67-r2`; local core overrides remain
  restricted to explicit PFB builds with closed candidate inventory checks.
- Capture freshly rendered GPU pixels without advancing the movie; bound startup waits and destroy
  cancelled instances even when asynchronous loading finishes late.

## 0.24.0

- Compress new Flycast instant checkpoints with lossless gzip and retain raw-state restoration.
  Retain the Flycast WebGL drawing buffer so screenshots remain available after pause/presentation.

- Advance EmulatorJS Provider to 2.6.0 and add a Dreamcast Flycast WASM JIT target with WebGL2, verified CHD caching,
  Dreamcast face-button mappings and independent instant checkpoint format.
- Pin Flycast core release `retrom-core-1.0-r1` with verified release metadata and licenses.
- Preserve RetroArch restore configuration when BIOS external-file hooks are installed.
- Validate local core candidate provenance and closed artifact sets before materializing
  EmulatorJS inputs; formal builds reject unpublished candidates.

## 0.23.1

- Add the Play! PS2 target with bounded ISO/CHD reads, standard gamepad input,
  screenshots, pause/resume and content-bound native snapshots including memory cards.
- Distribute Play! through the normal pinned core Release and Provider bundle.


## 0.22.0

- Advance the EmulatorJS Provider to 2.5.0.
- Add opt-in bounded input diagnostics without additional input polling, synthesis or changes to normal input values.
- Observe existing browser/runtime and adapter delivery boundaries, with optional MV/MZ bridge diagnostics. Core-read confirmation remains unavailable.

## 0.21.0

- Wait for MAME 2003 Plus to execute its first emulation frame before restoring. The core
  can serialize at frame zero but rejects automatic state loading at that point. Other
  cores retain serialization readiness, including cores with a zero diagnostic counter.
- Advance the EmulatorJS Provider to 2.4.1 and add Fuse, Gearcoleco, PrBoom, PUAE,
  VICE x128, VICE x64sc, VICE xvic and Virtual Jaguar as single-file targets. Multi-disc
  switching stays disabled for these targets. VICE xvic and Virtual Jaguar pin independently
  verified Retrom fork assets (VICE r1 and Virtual Jaguar r1); the other six retain the official 4.2.3 artifacts. Checkpoint restore keeps the 4.2.3 native-load
  observer active while intercepting its verbose native output before it reaches the browser
  console, and waits for the native load callback instead of counting frames. This avoids
  premature completion for large VICE and PUAE states. Fuse enables direct keyboard input
  and selects a Kempston joystick for the first controller port. Host exit also dispatches EmulatorJS's
  native exit lifecycle and waits for its bounded Wasm teardown, so a previous core cannot
  keep running while a saved session starts in a new instance.

## 0.20.0

- Add a ScummVM Target with selected-engine downloads, bounded persistent range files, native
  capture/export, exact-slot restoration and final save handoff.
- Pin the maintained ScummVM core release, including 105 engine plugins and the matching native detector.
  Verify fixed release metadata, archive size/digest and the complete internal layout; reject local core
  overrides in formal release builds.
- Reject mounting immediately if the native engine exits before initialization completes.
- Discover SDL3 controllers connected after startup or reconnected during play, including the native
  Y/Escape and stick-to-mouse mappings.
- Synchronize drawing dimensions during resize and pause, retaining WebGL pixels for readable save screenshots.

- Extend native-save capabilities with explicit capture/export intent and exact-startup-restore support. Native synchronization defaults to exporting existing files, while explicit capture can be available before the first save exists.
- Deliver validated final native saves with the common exit event, close live checkpoint operations immediately, and keep final payload bytes independent of engine cleanup.

## 0.19.0

- Add independent TIC-80 and FAKE-08 targets from current upstream mainline snapshots.
- Provide verified cartridge/assets, standard controls, Canvas/WebAudio, lifecycle cleanup and bounded checkpoints.
- Expose TIC-80 native pmem as GAME_SAVE with revision/acknowledgment; restore FAKE-08 execution and input-repeat state.
- Pin immutable TIC-80 r1 and FAKE-08 r2 core releases with exact source commits and asset identities.
- Restore FAKE-08 Lua sandbox bindings and suspend Eris collection until the restored object graph is complete; preserve resumed input and cartdata.


## 0.18.1

- Make `EXIT_REQUESTED` an optional lifecycle event instead of a core admission requirement. Existing adapters
  that report observable core-initiated exits keep their current cleanup behavior.

## 0.18.0

- Advance the EmulatorJS Provider to 2.3.2 for PSP output and checkpoint optimization.
- Select the pinned EmulatorJS 4.3.0-pre threaded PPSSPP core and include its resource archive and
  ZIP worker. Resolve the upstream PSP asset and report URLs within the immutable bundle.
- Limit PSP pixel/original output to 960×544 before uniform display scaling; preserve full-size
  shader rendering. Keep native settings within the current viewport to preserve paused frames. Keep window resizing, input and exit cleanup intact.
- Write complete PSP checkpoints as `emulatorjs-state-gzip-v1` with bounded streaming compression
  and decompression; continue decoding explicitly declared raw payloads. Wait for PSP Asyncify save/load with the main loop paused and skip boot-dialog input on restore. Copy native state bytes before freeing only
  their owned allocation, avoiding the pinned PSP helper’s invalid descriptor free. Other targets
  keep their checkpoint formats.

- Known limitation: threaded PPSSPP can lose newly appended audio samples while submitting its shared
  audio buffer, causing audible gaps. The core audio repair is deferred from this release.

## 0.17.0

- Add Java ME JAR execution with explicit GAME_SAVE semantics, stable RMS revisions, exact-payload acknowledgments and clean Host-managed launch storage. Native saves retain the RMS v1 format and require the game menu to restore progress.
- Use the repaired J2ME v0.3.4 runtime with native pixel operations, correct alpha compositing, independent record-store handles and frame presentation only when the core changes its display.
- Preserve every 0.16.8 startup, restore-readiness, Mega Drive control and delayed input fix, and the maintained MKXP r9 startup repair.
- Advance the EmulatorJS Provider to 2.2.4 for the shared checkpoint contract changes; existing instant save formats and pinned EmulatorJS core assets remain unchanged.

## 0.16.8

- Advance the EmulatorJS Provider to 2.2.3 for the DOSBox startup, restore-readiness, Mega Drive input and delayed startup control fixes; existing checkpoint formats and pinned core releases remain unchanged.
- Preserve the EmulatorJS game manager receiver for delayed PSP and Virtual Boy startup controls, preventing uncaught `EJS` property errors while retaining the configured press/release timing and exit cancellation.
- Select the Mega Drive controller layout explicitly for Genesis Plus GX, GX Wide and PicoDrive, preserving Start and the six face buttons instead of accepting EmulatorJS's automatic Master System layout. EmulatorJS 4.2.3 uses its equivalent `segaCD` input-layout alias; the core and content remain unchanged.
- Assign gamepads already detected during EmulatorJS construction to free player slots when controls become ready, preserving existing assignments and leaving later connections to EmulatorJS. This repairs the initial connection event lost before its listener was registered.
- Allow PFB to select the EmulatorJS development client with the persistent `providers/dev/provider-id` file, preserving the default retrom-runtime client.
- Prepare DOSBox state compatibility after EmulatorJS creates its game manager, so review previews can start before checkpoint operations.
- Use successful native serialization to gate EmulatorJS 4.2.3 restores without waiting on the diagnostic frame counter; native load completion remains required.

## 0.16.7

- Pin the maintained MKXP r9 core, which constructs FetchFS synchronization
  before starting its worker. This fixes the intermittent first-frame stall
  and subsequent exit timeout observed during sequential RPG Maker launches.
- Preserve checkpoint formats, completed state-I/O receipts and owner-loop
  shutdown. XP, VX and VX Ace pass sequential launch and cross-instance
  checkpoint/restore regressions, including restoration of an existing VX save.

## 0.16.5

- Advance the immutable Retrom Provider beyond the verified 0.16.4 development
  base. Provider targets and checkpoint formats remain unchanged; EmulatorJS
  remains at 2.2.2 with its independently fixed assets.
- Fix the compression dependency at fflate 0.8.3 (CVE-2026-45820). A bounded
  malformed-ZIP64 regression prevents reintroducing the parser's infinite loop;
  MKXP continues to use the same gzip checkpoint format and compatibility rules.
- Pin the formally published EasyRPG core r9, including ordinary game readiness
  and remote directory setup, with the calling-user release build verified.
- Pin the formally published MKXP core r8 with completed state-I/O receipts,
  bounded state allocation and owning-thread shutdown. Its published assets
  pass both pristine-source and compiled private-ABI release verification.
- Known limitation: an intermittent RPG Maker XP first-frame timeout during
  sequential launches remains under investigation. A successful diagnostic
  repeat does not resolve that observation. It is explicitly accepted as a
  follow-up for this release, independently of the fixed VX Ace state-I/O crash.

## 0.16.4

- Request MKXP save/restore through its owning core loop and await an explicit completed I/O receipt.
  Short-lived synthetic save/load hotkeys and file-length completion guesses are removed. The core
  preallocates exact raw state files to prevent WasmFS vector doubling at the RASTATE envelope boundary;
  the adapter releases temporary restore/save files after completion. This fixes native allocation
  aborts during restored VX Ace sessions and applies equally to XP/VX. Existing checkpoint formats
  are unchanged; the new private state-request/result core ABI is required without a legacy fallback.
- Keep Nostalgist's JavaScript cleanup after native MKXP exit without executing C++ global destruction
  a second time. Re-entering force-exit after its supporting pthreads terminated could hang Player exit,
  including after a successful checkpoint. Native exit remains acknowledged before host disposal.

## 0.16.3

- Initialize MKXP canvases with RGSS-native backing dimensions before mounting, so the shared frame
  surface and Nostalgist do not capture the HTML default 2:1 aspect ratio and double-letterbox gameplay.
- Request threaded MKXP shutdown on its owning core loop and await native completion before removing
  the canvas. This requires the core's private `_runtime_request_exit` ABI; it prevents live worker
  access during C++ global destruction and releases core-owned browser observers on normal exit.
  Checkpoint formats and the EmulatorJS Provider remain unchanged.

## 0.16.2

- Return keyboard focus to the game canvas (or isolated runtime window) after a successful resume in
  both Providers. Failed or cancelled Retrom runtime resumes do not reclaim input from Host controls.
- Advance the EmulatorJS Provider to 2.2.2 for the shared focus correction. Candidate validation keeps
  strict forward-only Provider activation and leaves fixed Release dependencies unchanged.

## 0.16.1

- Correct standard GamepadButton copying for browser prototype accessors, shared by both Providers.
- Restore the MKXP FetchFS manifest parent and preserve initialization errors during cleanup.
- Advance the EmulatorJS Provider to 2.2.1 for the shared input correction. Core candidates for local
  validation remain explicit inputs; they never replace the fixed Release dependencies.

## 0.16.0

- Create MKXP's fetch-manifest parent independently of the removed Ruby probe directories. Preserve initialization
  errors when cleaning up the core instead of misreporting cleanup as a game-owned exit.

- Preserve native getter-backed GamepadButton attributes in the shared immersive input filter used by both
  Providers. Copy pressed/touched/value explicitly so confirm, cancel, triggers and D-pad survive filtering.

- Advance the EmulatorJS Provider to 2.2.0 for the same unreleased V1 proof-contract removal, preserving
  its core assets and checkpoint format. Provider activation remains upgrade-only; no same-version bundle replacement.
- Remove the unreleased production validation workflow from Provider V1: no validation purpose, probe method,
  proof capability or expected-position option. Product play and review previews share ordinary controls.
- Keep actual engine, filesystem, checkpoint and restored-map readiness checks while removing EasyRPG and
  native Web dependencies on fixture variables. Native Web reports ordinary status without input/audio proofs.
- Remove the MKXP Ruby position preload. The adapter requires the threaded core's read-only presentation and
  restore-result exports, waits for successful deserialization and a subsequent frame, and restores ordinary
  checkpoints without host-provided evidence. Existing checkpoint formats remain unchanged.

## 0.15.0

- Remove the package-level RuntimeConfig/GameRuntime API, descriptor registry, conversion factory and inner
  controller. Provider creation directly constructs core-private parameters and owns a single lifecycle,
  serialized operation queue and cleanup path, including cancellation before restore/frame/core readiness.
- Remove the separate Provider precheck export. The current unreleased V1 creation boundary validates the external
  request once; expose CHECKPOINTING and EXITING directly instead of mapping a second controller's state.
- Wait for EasyRPG's configured engine identity while loading frames are already advancing; preserve bounded
  rejection of genuinely mismatched projects instead of rejecting RPG2003 during the core's initial RPG2000 state.
- Finish an EasyRPG restore mount only after the saved map is ready, so position validation cannot mistake the
  startup animation for a restored game. Fresh mounts still support interactive title scenes.
- Introduce the Runtime Provider V1 declaration model while preserving all eight adapters and twelve targets from
  `0.11.3`, including WASM-4, as the single source for generated public manifests and internal dispatch.
- Replace the duplicated runtime manifest with `provider-sources.json`; upstream source inputs and Provider Target
  declarations now have separate, non-overlapping authority.
- Add deterministic EmulatorJS and retrom-runtime Provider Bundle builds, closed integrity/provenance records,
  candidate/production isolation and the Provider Module V1 Launch Envelope boundary.
- Move exact Target options into each Provider declaration as a constrained closed schema and remove the duplicated
  Host-facing options discriminator.
- Make `providerId` plus `targetId` the sole stable Target identity; remove generated per-Target identity fields
  from declarations, manifests, Launch Envelopes, Provider Modules and EmulatorJS netplay profiles.
- Use stable suffixless semantic IDs for resource and content kinds while retaining explicit versions only for
  serialized documents, checkpoint formats and hash domains.
- Restore a provider-owned, same-origin frame surface for every DOM runtime, keeping core diagnostics out of the
  host framework console and fitting native-resolution canvases to the full viewport without changing save ABIs.
- Decouple fresh KiriKiri mount readiness from the first stable KAG bookmark point, expose checkpoint availability
  independently, and convert only the pinned core's exact Wasm indirect-call termination from either browser error
  channel into the shared exit lifecycle.
- Preserve the native Canvas2D `textAlign` invalid-value semantics for RPG Maker MV/MZ projects and acknowledge
  native runtime cleanup before the keepalive revocation request settles, so Player exit is prompt and warning-free.

## 0.11.4

- Update TyranoScript to `retrom-core-gc8dbfd492afd-r7` so checkpoint restoration preserves the engine system
  variables required to resume choices and scenario progression, while preserving the existing save ABI.

## 0.11.3

- Update TyranoScript to `retrom-core-gc8dbfd492afd-r6` so rapidly skipped videos abort their unfinished network
  requests instead of starving later project images, while preserving the existing save ABI.

## 0.11.2

- Update TyranoScript to `retrom-core-gc8dbfd492afd-r5` so dynamically inserted autoplay videos recover from
  browser autoplay blocking instead of leaving the game on a black frame, while preserving the existing save ABI.

## 0.11.1

- Accept the bounded JPEG or PNG screenshot media type reported by the TyranoScript bridge.
- Update TyranoScript to `retrom-core-gc8dbfd492afd-r4` for legacy 4.x lifecycle, input, media, checkpoint and
  composed screenshot support while preserving the existing save ABI.

## 0.11.0

- Add the WASM-4 browser runtime with verified single-cart loading, standard keyboard/gamepad input, screenshots,
  bounded instant checkpoints and fresh-instance restore through the shared lifecycle.
- Pin the maintained WASM-4 fork at `retrom-core-gca2600db8de4-r1` and aggregate its immutable Web runtime and MIT
  license assets.

## 0.10.2

- Add a PFB candidate build path that assembles the aggregate runtime directly from sibling core worktrees,
  validates their candidate descriptors, and supports watch-mode rebuilds without changing published manifests.

## 0.10.1

- Update Butterscotch to `retrom-core-gae2602f1f83c-r4` so checkpoint v2 restores GameMaker variables whose
  source metadata uses an empty name, preserving existing save compatibility.

## 0.10.0

- Move all maintained fork and aggregate Release identities to the `retrom-project` GitHub organization.
- Adopt the `retrom-core-<baseline>-rN` tag namespace for new core releases; existing `rpg-runtime-*` tags remain
  immutable historical records and are no longer accepted as current manifest inputs.

## 0.9.0

- Add a host-independent TyranoScript isolated-Web adapter with the shared lifecycle, standard browser gamepad
  support, bounded JPEG screenshots, semantic checkpoints, fresh-instance restore, BGM resume and core-owned exit
  reporting.
- Aggregate only the independently authored host bridge from the maintained TyranoScript fork. Game projects keep
  supplying their own TyranoScript engine files, so the aggregate Release does not redistribute the upstream engine.

## 0.8.2

- Update Butterscotch to `rpg-runtime-gae2602f1f83c-r3` and checkpoint ABI v2 so bounded GameMaker
  map/list/queue/stack/priority/grid pools survive direct checkpoint restore while unsupported runtime resources
  remain fail-closed.
- Preserve the core checkpoint blocker status so hosts distinguish temporary busy scenes from unsupported state.

## 0.8.1

- Make Butterscotch audio teardown idempotent so exiting a game cannot surface a closed `AudioContext` error.
- Update Butterscotch to `rpg-runtime-gae2602f1f83c-r2`, which clears the transient checkpoint blocker after a
  game closes its native INI save and keeps runtime warnings out of the browser error stream.

## 0.8.0

- Add the independent Butterscotch GameMaker runtime with OPFS-backed project streaming, keyboard and standard
  gamepad input, bounded direct checkpoints, new-instance restore, screenshots and core-initiated exit reporting.
- Aggregate the fixed `retrom-project/Butterscotch` stable Release while keeping all core builds in the
  maintained fork.

## 0.7.6

- Report game-initiated exits from EasyRPG, mkxp, native RPG Maker, ONS and KiriKiri through the shared
  `EXIT_REQUESTED` event, immediately leave the running lifecycle and disable checkpoint capture instead of
  leaving hosts on a saveable black canvas.
- Update ONScripterYuri to `rpg-runtime-0.7.7beta-r4`, where horizontal confirmation buttons follow D-pad
  selection, controller A activates the selected button, and a confirmed in-game exit terminates the Web core.

## 0.7.5

- Persist exact-size ONS project files one at a time in OPFS (with Cache Storage fallback) so large NSA archives survive across runtime instances,
  while streaming aggregate project byte progress through the shared `LOAD_PROGRESS` contract.
- Run RPG Maker MV/MZ's standard `$gameSystem.onBeforeSave()` and `onAfterLoad()` lifecycle around native checkpoints so engine-owned BGM/BGS state is captured and replayed after restore.

## 0.7.4

- Hold KiriKiri keyboard and gamepad input until the runtime is ready, then require one neutral gamepad frame so
  buttons held through loading cannot activate a partially initialized game menu.

## 0.7.3

- Resume a host-paused KiriKiri core before waiting for the next stable KAG bookmark point so immersive and
  standard-menu checkpoints do not time out during an in-progress scene transition.

## 0.7.2

- Keep KiriKiri running while KAG writes a semantic checkpoint, then capture the quiescent save-file set.
- Support KAG games that retain the bookmark API but override the default `data1999.ksd` filename.

## 0.7.1

- Fix the mkxp FetchFS manifest reader so Range-backed project startup does not write past the URL buffer.
- Preserve mkxp startup diagnostics and report missing position evidence with a precise failure code.

## 0.7.0

- Replace the RPG-shaped root API with one engine-neutral `createRuntime` / `GameRuntime` contract shared by
  RPG Maker, ONS and KiriKiri adapters.
- Move RPG Maker generation and position evidence behind the versioned `rpgmaker.position.v1` validation probe;
  generic checkpoint availability no longer exposes map, message or event semantics.
- Consolidate the duplicated RPG, ONS and KiriKiri lifecycle state machines into one controller and declare
  adapter capabilities plus checkpoint formats in the runtime manifest.
- Add the engine-neutral `SEEKABLE_BLOB` content source and advertise content-source capabilities per adapter.
- Mount mkxp project and RTP archives through strict WasmFS Range files instead of downloading every archive before
  startup; fixed core and bridge assets now use the browser's normal immutable cache.
- Load EasyRPG RTP files through the host file tree only when the game asks for a missing resource.
- Pass ONS video URLs to the browser media pipeline so large movies can use HTTP Range instead of being copied into
  the Emscripten file system first.
- Reject large KiriKiri file responses that ignore Range requests instead of silently downloading the complete file.

## 0.6.1

- Add a visible standard-gamepad virtual pointer to the shared KiriKiri adapter, with D-pad/left-stick movement,
  A/B mouse confirmation and cancellation, and complete held-button release on runtime exit.
- Define gamepad control, immediate checkpoint and different-instance restore as minimum capabilities for every
  core published by the aggregate runtime.

## 0.6.0

- Move ONScripterYuri and KiriKiri source changes, Web builds and core Release workflows into their maintained forks.
- Make the aggregate runtime download all third-party core assets from fixed fork tags; ordinary quality and Release
  workflows no longer compile any core.
- Add explicit local fork-asset overrides so core candidates can be tested through Retrom before publishing a fork tag.

## 0.5.0

- Add a KiriKiri2 Web runtime for KAG-compatible games, with a host-provided project index and explicit XP3 selection, browser controls,
  screenshots and small semantic checkpoints backed by KAG's native bookmark files.
- Schedule bookmark restore on the engine thread and report the runtime ready only after KAG reaches the restored stable save point.
- Pin the upstream `kirikiroid2-web` commit and apply an isolated Web-only bookmark host bridge during the tag
  build; no third-party runtime binary is committed to the repository.

## 0.4.2

- Declare the checkpoint format written by each core and the exact checkpoint formats each core can read. Host
  applications can move games to the current runtime while disabling only unreadable checkpoints; runtime rollback
  is not part of this contract.

## 0.4.1

- Fix ONS Web button menus so Up/Down update the selected entry before Enter confirms it. Browser builds now refresh
  the core's hover state directly instead of relying on unsupported browser cursor warping.

## 0.4.0

- Replace the raw 256 MiB mkxp checkpoint payload with the `mkxp-state-compact` adapter ABI. The core buffer remains
  unchanged; the adapter trims the zero-filled tail without a long main-thread scan, compresses in a worker and reconstructs the exact buffer on
  restore.
