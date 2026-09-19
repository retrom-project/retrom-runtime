# Intellivision

`emulatorjs/freeintv` uses the official EmulatorJS `v4.3.0-pre` release, pinned by
archive and core hashes. It accepts a single Intellivision cartridge and uses the
standard libretro gamepad, with shoulder buttons opening the numeric keypad.
The host supplies both `exec.bin` and `grom.bin` as BIOS resources. ECS, multi-disc
and netplay are not declared. Instant checkpoints use the shared bounded gzip
storage contract. The core compatibility report digest is recorded in
`artifactSetSha256`; it identifies the bundled report, not an exact core source commit.
The adapter removes the loader's hourly cache buster only from this pinned report's
GET request, so the host can serve the immutable bundle asset without a 400 response.
