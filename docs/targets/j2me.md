# Java ME

The `j2me` Target accepts one original JAR as `ROM_BLOB` and runs the public j2me-web API in a fresh,
thread-enabled same-origin frame. The Provider uses HOST storage: only the explicit restore payload is
imported before the MIDlet starts. A `GAME_SAVE` checkpoint contains the bounded RMS tree, not VM stacks,
heap or execution position. Save in the game first, upload through the Host, then use the game menu to load
in a new Launch. Other Targets declare their own save semantics in the [support catalog](../supported-platforms-and-cores.md).

The core verifies JAR size and SHA-256, reuses verified bytes from persistent content-addressed storage,
reports loading progress and applies only explicit device settings. Content names and hashes never select behavior patches. Core failures and game exits enter the
common Provider lifecycle. The pinned v0.4.1 release includes generic VM initialization and native I/O safepoints,
MIDI/tone playback, Display reentry, synchronous RMS delta commits and public startup choices.
Array allocation failures raise Java OutOfMemoryError; worker diagnostics are queued without blocking the browser thread.
Native alpha composition and demand-driven presentation remain supported. J2ME uses the `main` branch and immutable semantic version tags.

GAME_SAVE runtimes expose a stable availability `revision` for changed native records and
`acknowledgeCheckpoint(checkpoint)` for the exact payload durably stored by the Host. Exporting does not
advance the baseline. Empty/unchanged content remains unavailable; failed uploads remain retryable, and
changes during an upload retain a new revision. The Host owns automatic upload policy; the J2ME core owns
RMS content comparison, stable-write detection and restore baselines. INSTANT targets retain manual capture.

## Controls

J2ME standard gamepads use the following phone actions. The Provider owns gamepad polling in the game frame and preserves the Host's input filter; the core owns physical keyboard input.

| Standard control | Phone action |
| --- | --- |
| D-pad / left stick | Up, down, left, right |
| A | Fire / confirm |
| B / Select | Right soft key |
| X / Start | Left soft key |
| Y | 1 |
| L1 / R1 | 3 / 7 |
| L2 / R2 | 9 / 0 |
| L3 / R3 | * / # |

Direction and Fire actions are separate from numeric keys 2, 4, 6, 8 and 5. Physical keyboard digits 0–9, star, hash and the core's existing soft-key bindings remain available. Start+Select chords remain reserved by the Host filter; gamepad keys are released on suppression, focus loss, pause, disconnection and exit.

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

## Startup interaction

All applications construct and start on an AMS thread. A multi-entry JAR publishes the generic
`STARTUP_INTERACTION` event while the Provider remains MOUNTING. The Host shows its title and choices,
uses the shared keyboard/gamepad navigation, and replies with
`respondToStartupInteraction(interaction.id, choice.id)`. `exit()` cancels that startup session independently
of the pending adapter mount. No entry is automatically chosen from a content identity or assumed to be
first. A selected MIDlet's actual frame and input readiness are required before RUNNING.

The release also fixes exact ZIP entry names, event-driven Display transitions, MIDI serialization
and native ToneControl replacement, class-initialization ownership and reentrant method resolution.
RMS commits changed records synchronously with metadata as their commit point and a recoverable undo
journal. In-flight transactions cannot be exported. The stable RMS file layout and GAME_SAVE semantics
remain unchanged.
