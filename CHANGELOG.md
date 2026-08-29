# Changelog

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
