# Changelog

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
