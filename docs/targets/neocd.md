# NeoCD

`emulatorjs/neocd` accepts a single CHD as `SEEKABLE_BLOB`. The host supplies the
installed CDZ BIOS as an external file at `/neocd/neocd.bin`. Ordinary loading uses bounded reads through shared [Content I/O](../content-io.md), which may coalesce or prefetch native reads using its fetch policy. Explicit full preload is a separate loading choice.
Shared bounded memory and persistent block caches reuse content across Launches.
Responses require 206, exact Content-Range/length and the frozen digest ETag;
cached blocks carry a locally computed SHA-256 to detect corruption. This is
block transport/cache validation, not a whole-file client hash verification.
Cache denial/quota errors keep bounded network reads; ignored Range responses
fail rather than silently downloading the entire image.

The fork's rchd reader suspends through Asyncify only for missing blocks. The
adapter waits for suspended reads at pause/checkpoint boundaries and aborts them
on exit. Instant state retains `emulatorjs-state-v1-storage-v1` compatibility.
Standard bottom/right/left/top buttons map to native A/B/C/D independently.
The source catalog pins the published fork release `retrom-core-g3118c6901787-r1`.
Unpublished overrides remain limited to explicit PFB candidates; ordinary release
builds reject them. See the bundled EmulatorJS third-party notices for the
bundled Z80 component's non-commercial restriction.
