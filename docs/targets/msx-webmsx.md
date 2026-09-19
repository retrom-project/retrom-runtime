# MSX / WebMSX

`msx-webmsx` accepts one `game: ROM_BLOB` (16 MiB maximum), using the maintained
WebMSX fork's `webmsx-host-v1` ABI and a fixed Japanese MSX2+ machine. It exposes
pause/resume, screenshots and bounded instant checkpoints (`webmsx-state-v1`, 32 MiB).
Snapshots carry the content digest and complete machine state, including writable media;
only an explicitly supplied checkpoint is restored. Exact media size and SHA-256 are
verified before loading, with Cache Storage reuse across Launch URLs and bounded progress.

The source is `retrom-project/WebMSX`, maintained from upstream v6.0.8 at
`4f4009e86d3e0bb9be7dcd7f0a582b0cd411d660`. `provider-sources.json` pins the
`retrom-core-6.0.8-r1` release commit, ABI and exact sizes/SHA-256 of `webmsx.js`
and `UPSTREAM-NOTICE.txt`. Aggregation verifies the release metadata and both assets.
Local candidate overrides are accepted only in explicit PFB builds, never formal releases.
Upstream references a missing license file; this integration does not assert MIT/GPL
licensing. The dedicated notice and release metadata preserve unresolved source and
embedded machine-ROM distribution status; publication does not grant those rights.
