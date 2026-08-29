# Changelog

## Unreleased

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
