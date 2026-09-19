# Java ME

The `j2me` Target accepts one original JAR as `ROM_BLOB` and runs the public j2me-web API in a fresh,
thread-enabled same-origin frame. The Provider uses HOST storage: only the explicit restore payload is
imported before the MIDlet starts. A `GAME_SAVE` checkpoint contains the bounded RMS tree, not VM stacks,
heap or execution position. Save in the game first, upload through the Host, then use the game menu to load
in a new Launch. Other Targets default to `INSTANT`; their direct restore requirements are unchanged.

The core verifies JAR size and SHA-256, reuses verified bytes from persistent content-addressed storage,
reports loading progress and resolves known compatibility profiles. Core failures and game exits enter the
common Provider lifecycle. The pinned v0.3.4 release includes verified RMS persistence, native alpha
composition and demand-driven presentation. J2ME uses the `main` branch and immutable semantic version tags.

GAME_SAVE runtimes expose a stable availability `revision` for changed native records and
`acknowledgeCheckpoint(checkpoint)` for the exact payload durably stored by the Host. Exporting does not
advance the baseline. Empty/unchanged content remains unavailable; failed uploads remain retryable, and
changes during an upload retain a new revision. The Host owns automatic upload policy; the J2ME core owns
RMS content comparison, stable-write detection and restore baselines. INSTANT targets retain manual capture.

## Native Capture and Final Exit

For `GAME_SAVE`, `checkpoint({intent: "EXPORT"})` exports existing native files without requesting a new
in-game save. This is also the default for native-save synchronization. A runtime may expose `availability.save`
with independent `capture` (`RUNTIME` or `IN_GAME`) and `restore` (`AUTOMATIC` or `IN_GAME`) capabilities.
`captureAvailable` means `checkpoint({intent: "CAPTURE"})` can create a new native save now, even if
`availability.available` is false because no unsynchronized save exists. Automatic restore describes the
runtime's exact-slot startup capability; individual exported bundles may still require the game's load menu
when no reliable slot is known. These are native files, not an instant memory snapshot.

A native engine's `EXIT_REQUESTED` event may include `finalSnapshot: {checkpoint, screenshot}` after its last
save streams and destructor writes have closed. The runtime is already exiting; the Host must persist these
bytes directly and must not call live checkpoint/screenshot APIs to obtain them. A missing screenshot is
represented by `null`. The final checkpoint obeys the same declared format and byte limit. Live save
acknowledgments still occur only after durable Host persistence; a final snapshot is detached from the closed
runtime and needs no acknowledgment. Identical native content retains its revision across repeated writes.
