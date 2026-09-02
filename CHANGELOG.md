# Changelog

## Unreleased

## 0.11.1

- Accept the bounded JPEG or PNG screenshot media type reported by the TyranoScript bridge.
- Update TyranoScript to `retrom-core-gc8dbfd492afd-r4` for legacy 4.x lifecycle, input, media, checkpoint and
  composed screenshot compatibility while preserving the existing save ABI and game compatibility line.

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
- Add the engine-neutral `SEEKABLE_BLOB_V1` content source and advertise content-source capabilities per adapter.
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

- Declare a stable game compatibility line, the save ABI written by each core, and the exact save ABIs each
  core can read. Host applications can move games to the current runtime while disabling only incompatible
  checkpoints; runtime rollback is not part of this contract.

## 0.4.1

- Fix ONS Web button menus so Up/Down update the selected entry before Enter confirms it. Browser builds now refresh
  the core's hover state directly instead of relying on unsupported browser cursor warping.

## 0.4.0

- Replace the raw 256 MiB mkxp checkpoint payload with the `mkxp-state-compact` adapter ABI. The core buffer remains
  unchanged; the adapter trims the zero-filled tail without a long main-thread scan, compresses in a worker and reconstructs the exact buffer on
  restore.
