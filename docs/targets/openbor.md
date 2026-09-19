# OpenBOR

The Provider includes `openbor`, backed by the maintained
[OpenBOR fork](https://github.com/retrom-project/openbor) and `openbor-host-v1`.
It accepts one PAK32 game package (up to 512 MiB), supports standard gamepad input,
pause and screenshots, and exposes native level saves as `GAME_SAVE` with
`openbor-game-save-v1` (up to 16 MiB). Games save at their native level boundaries;
restoration requires the in-game Load Game menu. Instant snapshots are not declared.
Core binaries and their licenses come from the fork; no games are included.
Unpublished development inputs require explicit PFB candidate mode and cannot be
used for a formal release. Formal aggregation pins `retrom-core-g9d81480f8481-r1`
with verified release metadata, asset sizes and SHA-256 digests.
