# ScummVM Projects

The `scummvm` Target uses the fork's `scummvm-host-v1` Emscripten backend, pinned to
ScummVM `v2026.3.0` (`fed42f2068dcafc6aafa1c28c77e4c88def74b66`). The declared layout contains
105 stable parent-engine plugins. A fresh instance fetches the shared module and only its selected
engine plugin. Support data and game files use 256 KiB range blocks, a 16 MiB memory cache and
persistent Cache Storage; a later instance reuses verified immutable blocks. Game identification
and candidate selection happen in the consuming Host using the fork's matching native detector.
The adapter receives the selected engine/game, relative root and unchanged upstream launch hints.

Native checkpoint format `scummvm-save-bundle-v1` has a 64 MiB bound and preserves the complete
native save directory. It binds files to the game content and deterministic launch configuration.
`CAPTURE` asks the game to create a new native save only when its current state permits saving;
`EXPORT` merely collects completed writes. A known exact slot enables automatic startup recovery
when the game supports it. Saves collected from an in-game menu without an exact slot require
in-game recovery; the adapter never guesses from modification time or a highest slot number.
Core shutdown closes live capture before disposal, then exports any final destructor writes through
the public final-snapshot event. New frames start with empty save storage unless given a restore payload.

The ScummVM source is pinned in `provider-sources.json` to a published maintenance tag and exact
fork commit, ABI, upstream baseline, archive size and SHA-256. Aggregation verifies the release
metadata, closed file layout, plugin mapping and individual file digests before staging any assets.
The native detector and browser engines always come from the same verified archive. Explicit PFB
builds can consume a verified fork-owned core candidate; formal release builds reject local core
overrides. Unpublished inputs remain restricted to full PFB candidates.
The native detector supports Linux x86-64. The consuming Host must reject other
server architectures until the fork supplies matching verified tool assets.

ScummVM automatic restoration waits for an explicit native deserialization result
for the exact slot. The current fork provides this observation for Sky, SCUMM,
SCI, Queen and Drascula; other engines retain in-game restoration even when upstream
advertises startup loading. A missing, rejected or mismatched completion fails
mounting within 60 seconds. A bundle without an exact slot always reports in-game
restoration; feature flags alone never turn an arbitrary file collection into an
automatic restore target.
