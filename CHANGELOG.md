# Changelog

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
