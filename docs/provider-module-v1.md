# Provider Module V1

Hosts integrate the generated Provider Bundle, not an engine registry or the legacy adapter API. A Bundle exports
one `client.mjs` with this closed interface:

```ts
export const providerId = "retrom-runtime";
export const providerVersion = "0.16.0";
export const providerApiVersion = 1;
export async function createRuntime(
  value: unknown,
  host: RuntimeHostV1,
): Promise<PlayerRuntimeV1>;
```

The host validates a Launch Envelope V1, verifies the module URL and SHA-256 against the active Bundle, imports
the module, checks the exported identity and calls `createRuntime`. It only consumes `PlayerRuntimeV1`; it never
chooses EasyRPG, mkxp, native Web or another implementation. The Provider validates the stable `providerId` plus
`targetId`, current resources, private Target options, optional restore input before mounting.

`src/providers/retrom-runtime/catalog.ts` is the single Target declaration for the 14 targets in this Provider.
The generated declaration provides current capabilities, checkpoint `writeFormat/readFormats/maxBytes/semantics`, resource
kinds, runtime files and a constrained closed `targetOptionsSchema`. The Provider Module uses that schema to
exact-validate options before mounting; it has no
`optionsKind` discriminator. A Host dispatcher only needs generic JSON safety, depth and size limits and must not
copy these Target-specific properties. `provider-sources.json` records only pinned upstream Release/build sources;
it cannot declare a Target or host binding. Product play and review previews use the same ordinary controls.
There are no production proof gates, fixture variables, validation probes, or expected-position Target options.
Strict input, visual and restored-position assertions belong to development acceptance through real game fixtures.

The package root exports the same Provider entry and public ABI types. There is no separate runtime constructor,
generic adapter config, config conversion layer or inner controller. The Provider creates minimal, typed parameters
for the selected core directly. One controller owns state, progress, serialized operations, cancellation and cleanup;
the Host separately owns the page, frame and authorization session. The public state is CREATED, MOUNTING, RUNNING,
PAUSED, CHECKPOINTING, EXITING, EXITED or FAILED. Exit preempts pending controls and checkpoints; cancellation is
checked after each asynchronous startup boundary and a late core is cleaned without returning to RUNNING.

Only Provider creation validates the external Envelope and Host against the Provider declaration. There is no
public precheck call or repeated internal Envelope/config validation. File downloads, decoded checkpoints and
cross-origin messages retain their own trust-boundary validation.

Content sources are also host-independent. Directory-oriented adapters consume
`FILE_TREE`; mkxp consumes `SEEKABLE_BLOB`; native Web projects retain
their isolated entry model. A seekable blob supplies a URL, size, diagnostic
digest and `rangeRequired: true`. The mkxp adapter registers that URL in
WasmFS and passes only a virtual path to the core—it does not turn the project
or RTP archives into JavaScript `Blob`s or download them before the first
frame. Its pinned fork rejects a missing Range contract, a non-206 response,
an inexact `Content-Range`, and response-length drift instead of silently
falling back to a whole-file request. Core JS/Wasm and bridge assets still use
full-byte validation, while their immutable URLs use the browser cache.

EasyRPG receives both the project and optional RTP as `FILE_TREE` roots. The project wins when it contains a
resource; only a missing resource that the game actually opens is fetched from the RTP root. ONS keeps ordinary
scripts and images on the same file-on-first-open path. Exact-size immutable responses are streamed into the
Emscripten file system and an origin-private file one at a time, so concurrent multi-hundred-megabyte writes cannot
evict or drop one another and archives larger than Chromium's ordinary HTTP or Cache Storage entry limits are still
reused by a later runtime instance. Cache Storage is only the fallback when OPFS is unavailable. Aggregate project
bytes are reported through `LOAD_PROGRESS`; persistent storage being unavailable or full falls back to the normal fetch without
blocking the game. Large videos are handed to the browser media pipeline by URL so it can issue Range requests
instead of copying the complete movie into the Emscripten file system. KiriKiri keeps its 256 KiB-block VLFS Range
reader and refuses a large response that ignores a requested range rather than silently buffering the whole file.

Native RPG Maker MV/MZ checkpoints use the engine's `DataManager` and a temporary private storage slot. The bridge
also executes the standard `$gameSystem.onBeforeSave()` and `onAfterLoad()` hooks at the same lifecycle boundaries
as the engine save/load scenes. This preserves engine- and plugin-owned resume state such as the current BGM/BGS
without inventing host-specific playback behavior. EasyRPG, mkxp, ONS and KiriKiri restore through their core state
or native save APIs and do not use these RPG Maker Web hooks.

Butterscotch is an independent GameMaker runtime. Its host config points to an exact project index containing one
root `data.win`. Files stream into an OPFS directory keyed by the host content digest, so later runtime instances
reuse exact-sized bytes without another network transfer. The adapter renders on a centered 640×480
`OffscreenCanvas`, forwards keyboard and standard gamepad state, emits load progress, captures bounded direct
checkpoints, restores them in a new Worker instance and reports a core-initiated exit through the common lifecycle.
The Target accepts only GameMaker data versions supported by the pinned Butterscotch core and runtime states its
checkpoint status reports as supported.

TyranoScript projects use the engine already present in the imported game and run in a per-Launch isolated origin.
The host injects the small, independently licensed bridge aggregated from the maintained fork; the aggregate runtime
does not redistribute TyranoScript itself. The adapter connects over a strict `MessageChannel`, delegates standard
gamepad input to TyranoScript's browser input layer, captures a bounded semantic snapshot without a thumbnail and
restores it in a fresh frame without opening the game's load menu. Restore uses TyranoScript's normal load lifecycle,
including its current BGM replay, and waits for `load-complete` before reporting ready. A game `[close]` command is
translated into the common `EXIT_REQUESTED` event instead of leaving the host on a closed or black frame.

Modern TyranoScript uses its native gamepad input. Old engines without the event
API use only the bridge's keyboard mapping (A/Start to Enter, B to Escape and
D-pad to arrows); the same press does not also emit gamepad events. Real keyboard
events remain available. This preserves existing legacy confirmation/cancellation
without requiring every core to implement cancellation.

WASM-4 consumes one content-addressed cart of at most 64 KiB and verifies its exact byte length and SHA-256 before
starting the core. The maintained fork exposes a host-independent Web module with keyboard and standard-gamepad
input, screenshots, bounded `wasm4-state-v1` checkpoints and direct restore in a fresh instance. Checkpoints bind
WASM memory, exported mutable globals and the bounded WASM-4 disk to the exact cart digest.

ONS is a separate Provider Target rather than an RPG Maker generation. A Host launches target
`onscripter-yuri` through Provider Module V1 and only interacts with the returned `PlayerRuntimeV1`;
the ONS adapter config and constructor are private implementation details of the Provider.

Each session must use its own frame. `exit()` pauses the core and removes library-owned DOM and globals; the host
then discards that frame to release Emscripten's document-level input hooks.

`EXIT_REQUESTED` is an optional lifecycle event rather than a Target admission requirement. An adapter that can
reliably observe a game ending through its title/menu UI or process boundary may translate it into one
`EXIT_REQUESTED` event. The shared controller then immediately leaves the running state, makes checkpoint capture
unavailable and releases the adapter. A host should subscribe before `mount()`, finish its play session and leave
or close the Player when it receives this event. Targets that cannot observe their own termination remain valid;
the host ends those sessions through `exit()`.

KiriKiri is also an independent Provider Target. A Host launches target `kirikiri2-kag` through
Provider Module V1 and never imports the KiriKiri adapter config or constructor.

The KiriKiri Target accepts games exposing the standard KAG `saveBookMark`/`loadBookMark` API. Its checkpoint
contains the small native KAG save files written under
`/savedata` or `/save`; it is not a raw Wasm memory snapshot. A pure TJS/custom-engine title without these KAG
methods fails closed as unsupported instead of producing a checkpoint that cannot be restored. The host supplies
a project file index and, only when that project contains multiple XP3 archives, the explicit project-relative XP3
entry selected during import. Runtime slot `1999` is outside the normal KAG save menu. The adapter keeps the core
running until the successful slot request causes a non-bookkeeping save write, then captures the complete quiescent save-file
set. This also supports KAG games that override the default `data1999.ksd` filename while retaining the standard
bookmark API. If the host paused the runtime before asking for a checkpoint, the adapter resumes it before waiting
for the next stable KAG save point and restores the paused state after capture.

The KiriKiri Web core does not expose its native pad-key conversion in Emscripten builds. The adapter therefore
provides a visible virtual pointer: a standard gamepad's D-pad and left stick move it, A performs a left click and
B performs a right-click cancel. Runtime cleanup releases every held button. The same runtime path is used by host
review previews and product players.

ONScripterYuri receives its native standard-gamepad D-pad and face-button events through SDL. The adapter adds
only the missing standard left-stick direction mapping, with dead-zone hysteresis and complete key release on
exit. It also creates the core's WebGL context with a retained drawing buffer so host-requested review and save
screenshots contain the displayed frame instead of a cleared black buffer.

## Optional Input Diagnostics

Provider Module V1 exposes optional `startInputDiagnostics()` with bounded `read`, `clear` and idempotent `stop`.

RPG Maker MV/MZ optionally expose `getGameEditor()` on `PlayerRuntimeV1`. It returns a host-neutral editor with `categories()`, paginated `entries(category, query, offset, limit)`, and `set(category, id, value)`. The native iframe bridge reads and writes the engine's live `$gameParty`, `$gameVariables`, `$gameSwitches`, and party actor APIs through the existing isolated MessageChannel. The first release supports gold, item/weapon/armor counts, variables, switches, and common actor attributes. Unsupported variable values are read-only. Edits affect the current game state; persistence follows the game's normal save flow.
It observes existing input events, gamepad reads and adapter delivery boundaries only while enabled. It never polls
extra gamepad frames, synthesizes inputs or pauses/resumes a game. The Host may refresh snapshots at up to 10 Hz.
The history retains 64 transitions; gamepad values are quantized for diagnostics only. Unsupported observation points
remain unavailable and `coreRead` is always false: an input API call is not evidence that a game acted on it.
EmulatorJS delivery observation applies to single-player; MV/MZ use the existing isolated bridge STATUS cadence.
Other inaccessible isolated frames explicitly remain unavailable. Sessions are cleaned up on disable and exit.
