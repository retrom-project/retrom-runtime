# NeoCD

`emulatorjs/neocd` accepts a single CHD as `SEEKABLE_BLOB`. The host supplies the
installed CDZ BIOS as an external file at `/neocd/neocd.bin`. Only requested
256 KiB blocks are fetched; no whole-disc download or hash scan precedes startup.
A 16 MiB memory LRU and persistent block cache reuse content across Launches.
Responses require 206, exact Content-Range/length and the frozen digest ETag;
cached blocks carry a locally computed SHA-256 to detect corruption. This is
block transport/cache validation, not a whole-file client hash verification.
Cache denial/quota errors keep bounded network reads; ignored Range responses
fail rather than silently downloading the entire image.

The fork's rchd reader suspends through Asyncify only for missing blocks. The
adapter waits for suspended reads at pause/checkpoint boundaries and aborts them
on exit. Instant state retains `emulatorjs-state-v1-storage-v1` compatibility.
Standard bottom/right/left/top buttons map to native A/B/C/D independently.
The pinned PFB candidate is not a published release. Ordinary release builds
reject unpublished sources. See `EMULATORJS_THIRD_PARTY_NOTICES.md` for the
bundled Z80 component's non-commercial restriction.
