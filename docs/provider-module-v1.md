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

Startup separates transport inactivity from engine initialization. Each observed XHR/fetch has a 30-second
idle deadline, renewed only by increasing received bytes, including unknown-length responses. Active transfers
suspend the engine deadline; after the last transfer, initialization receives its own 30 seconds (120 seconds
for the existing DOS/Supermodel restore path). A stalled parallel request still fails even while another downloads.
Cancellation aborts pending transports and clears timers. HTTP responses retain upstream fallback semantics.
The Provider reports `PLAYER_RESOURCE_IDLE_TIMEOUT`, `PLAYER_RESOURCE_NETWORK_FAILED`,
`PLAYER_CORE_INITIALIZATION_TIMEOUT`, `PLAYER_RUNTIME_INITIALIZATION_FAILED` or `PLAYER_RUNTIME_CSP_BLOCKED`
through the ordinary FAILED state. Module V1 reports FATAL_ERROR with a structured failure: stable code, STARTUP/PLAYING phase,
CONTENT/NETWORK/STORAGE/SECURITY/CORE/CONFIGURATION category, retryable and diagnostics. Only known
temporary network errors are retryable. Native causes are copied before cleanup, stripped of URLs, paths and
credentials, and bounded to eight entries of 500 characters. Content I/O length, checksum and immutable-identity
mismatches are CONTENT failures and are not automatically retried. Hosts retain the failure and return navigation
after teardown; they never classify errors by parsing native messages. Mount completion removes transport
wrappers and deadlines; frame error, rejection and CSP listeners survive until exit to observe gameplay failures.
The browser's message-only Resize Observer deferred-delivery notification does not terminate the runtime;
it remains observable by browser diagnostics. Script exceptions, Wasm traps and unhandled rejections still fail.

EasyRPG requires an explicit startup cancellation signal. Its factory/script errors and enforced eval CSP
violations fail mounting immediately instead of leaving a pending factory promise. Browser release builds use
Emscripten `DYNAMIC_EXECUTION=0`; the maintained core's release verifier rejects dynamic JavaScript execution.
Product CSP continues to allow Wasm compilation without enabling JavaScript `unsafe-eval`.

Only Provider creation validates the external Envelope and Host against the Provider declaration. There is no
public precheck call or repeated internal Envelope/config validation. File downloads, decoded checkpoints and
cross-origin messages retain their own trust-boundary validation.

Content sources are also host-independent. Directory-oriented adapters consume
`FILE_TREE`; mkxp consumes `SEEKABLE_BLOB`; native Web projects retain
their isolated entry model. A seekable blob supplies a URL, size, diagnostic
digest and `rangeRequired: true`. In default ON_DEMAND mode, mkxp registers that URL in
WasmFS and passes only a virtual path to the core—it does not turn the project
or RTP archives into JavaScript `Blob`s or download them before the first
frame. Its pinned fork rejects a missing Range contract, a non-206 response,
an inexact `Content-Range`, and response-length drift instead of silently
falling back to a whole-file request. Core JS/Wasm and bridge assets still use
full-byte validation, while their immutable URLs use the browser cache.

EasyRPG and mkxp declare optional `rtp` inputs for hosts that supply external resources. The Provider does not
install packs, discover a host's installations, or choose them automatically. A host that uses self-contained
projects omits these inputs; EasyRPG receives no RTP root and mkxp receives no RTP archives. This optional
runtime resource contract does not require a host application to expose pack management.

EasyRPG receives the project and any supplied RTP as `FILE_TREE` roots. The project wins when it contains a
resource; only a missing resource that the game actually opens is fetched from the RTP root. ONS keeps ordinary
scripts and images on the same file-on-first-open path. Exact-size immutable responses are streamed into the
Emscripten file system and an origin-private file one at a time, so concurrent multi-hundred-megabyte writes cannot
evict or drop one another and archives larger than Chromium's ordinary HTTP or Cache Storage entry limits are still
reused by a later runtime instance. Cache Storage is only the fallback when OPFS is unavailable. Aggregate project
bytes are reported through `LOAD_PROGRESS`; in default ON_DEMAND mode, persistent storage being unavailable or full falls back to the normal fetch without
blocking the game. Large videos are handed to the browser media pipeline by URL so it can issue Range requests
instead of copying the complete movie into the Emscripten file system. KiriKiri keeps its 256 KiB-block VLFS Range
reader and refuses a large response that ignores a requested range rather than silently buffering the whole file.

Native RPG Maker MV/MZ checkpoints use the engine's `DataManager` and a temporary private storage slot. The bridge
also executes the standard `$gameSystem.onBeforeSave()` and `onAfterLoad()` hooks at the same lifecycle boundaries
as the engine save/load scenes. This preserves engine- and plugin-owned resume state such as the current BGM/BGS
without inventing host-specific playback behavior. EasyRPG, mkxp, ONS and KiriKiri restore through their core state
or native save APIs and do not use these RPG Maker Web hooks.

Butterscotch is an independent GameMaker runtime. Its host config points to an exact project index containing one
root `data.win`. Read-only WasmFS files use Content I/O Range reads and persistent block reuse; only native saves
optionally use OPFS. The adapter renders on a centered 640×480
`OffscreenCanvas`, forwards keyboard and standard gamepad state, emits load progress, captures bounded direct
checkpoints, restores them in a new Worker instance and reports a core-initiated exit through the common lifecycle.
The Target accepts only GameMaker data versions supported by the pinned Butterscotch core and runtime states its
checkpoint status reports as supported.
The first four browser gamepad slots retain their indices, including disconnected or unsupported holes.
Each input frame requires the core's atomic `setGamepads` export; the adapter and core must be released together.
Game code owns controller selection and multiplayer behavior. The adapter does not merge devices or select by game name.
Checkpoint restore submits the current complete gamepad snapshot before resuming the runner, so a delayed first
animation-frame poll cannot make already connected controllers appear temporarily disconnected to restored game code.
Keyboard holds are released when the canvas or window loses focus, the document becomes hidden, or the adapter
pauses. A key released outside the game therefore cannot remain stuck; paused sessions ignore new key presses.

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

The KiriKiri Web core does not expose its native pad-key conversion in Emscripten builds. It uses the shared
Provider gamepad cursor (enabled by default); Ruffle uses the same implementation with PointerEvents (disabled
by default). Adapters expose `gamepadCursor` with an actual input surface and event protocol, without private
polling or drawing implementations. After mount, optional `PlayerRuntimeV1.getGamepadCursor()` returns a public
controller (`getState(): {enabled, defaultEnabled}`, `setEnabled(boolean)`), or null for unsupported adapters.
This instance capability does not change the manifest or checkpoint contract.

D-pad/left stick move the pointer inside the game surface, A/B hold and release left/right mouse buttons, and LB
reduces speed to 20%. These controls are consumed before native gamepad/keyboard mappings; other controls,
other gamepads and host menu chords remain available. Host input policy selects the claimed Gamepad.index.
Closing, pausing, checkpointing, losing focus, disconnecting or exiting releases held mouse buttons without clicks.
Resuming waits for neutral input. Disabling gates held controls before returning them to native mappings. Drag
movement carries the full buttons mask and release after movement exceeding 4 CSS pixels does not emit click.
Each normal button edge first sends motion at the virtual position with the previous buttons mask. Consumers
that cache coordinates from motion (including SDL) must not click at a stale physical mouse position after
startup, restoration, or toolbar use. Cancellation still releases without movement or activation.
Cursor polling reads the raw gamepad source without advancing the stateful host chord detector.
The shared gamepad filter remains installed until exit so cursor and host filtering have one stable lifecycle.
Hosts own per-game preferences; adapters never persist user settings. Relative mouse/pointer lock is not supported.

EmulatorJS creates WebGL contexts with a retained drawing buffer in its isolated runtime iframe, before loading
the frontend or core. This keeps the displayed frame available for review and save screenshots after pause when
native framebuffer capture is unavailable or has a different orientation. The override leaves 2D contexts and
the host window unchanged and is restored when the runtime exits. Native framebuffer capture remains preferred.

ONScripterYuri receives its native standard-gamepad D-pad and face-button events through SDL. The adapter adds
only the missing standard left-stick direction mapping, with dead-zone hysteresis and complete key release on
exit. It also creates the core's WebGL context with a retained drawing buffer so host-requested review and save
screenshots contain the displayed frame instead of a cleared black buffer.

## Native settings

When EmulatorJS native settings are open, the Provider hides its virtual gamepad until the settings close. This applies to controls, display and core panels, preserving the current pause state. A missing native panel fails without exposing an empty native menu. The Host owns navigation back to its settings; it must leave the iframe unobstructed while a native panel is active.

## Optional Input Diagnostics

Provider Module V1 exposes optional `startInputDiagnostics()` with bounded `read`, `clear` and idempotent `stop`.

RPG Maker MV/MZ optionally expose `getGameEditor()` on `PlayerRuntimeV1`. It returns a host-neutral editor with `categories()`, paginated `entries(category, query, offset, limit)`, and `set(category, id, value)`. The native iframe bridge reads and writes the engine's live `$gameParty`, `$gameVariables`, `$gameSwitches`, and party actor APIs through the existing isolated MessageChannel. It supports gold, item/weapon/armor counts, variables, switches, actor attributes, skills, states, classes, and party members. Unsupported variable values are read-only. The optional `selfSwitches` interface lists maps and events independently in pages. It lists only events with a self switch used as an event-page appearance condition, and each event includes the referenced switch keys, page numbers, and page summaries. It reads the current map from `$dataMap`, loads another map's project JSON on demand only after validating its ID against `$dataMapInfos`, and writes through `$gameSelfSwitches.setValue([mapId, eventId, key], value)`. It verifies the map, event, and referenced switch key before writing, then reads the switch back. Edits affect the current game state; persistence follows the game's normal save flow.
It observes existing input events, gamepad reads and adapter delivery boundaries only while enabled. It never polls
extra gamepad frames, synthesizes inputs or pauses/resumes a game. The Host may refresh snapshots at up to 10 Hz.
The history retains 64 transitions; gamepad values are quantized for diagnostics only. Unsupported observation points
remain unavailable and `coreRead` is always false: an input API call is not evidence that a game acted on it.
EmulatorJS delivery observation applies to single-player; MV/MZ use the existing isolated bridge STATUS cadence.
Other inaccessible isolated frames explicitly remain unavailable. Sessions are cleaned up on disable and exit.

## Startup tasks

`LOAD_TASK` reports an invocation-local unique `id`, a public `kind`, explicit
`RUNNING`, `COMPLETED` or `FAILED` state, and optional exact byte progress.
All declared Targets pass through shared environment and mount barriers. Content I/O
preparation and materialization add byte-aware tasks; EmulatorJS and independent
loaders bridge their own promises through the same event contract. Only present
BIOS, parent and restore inputs create their corresponding tasks.

An operation completes only when its preparation promise returns, including cache
commit, extraction, native mounting or restore work at that boundary. A byte counter
at 100 percent is still RUNNING. Unknown totals remain indeterminate. Parallel tasks
keep independent identities. Failure never reports completion; aborted or exited
instances suppress late events while retaining cleanup ownership of late resources.
Task reporting stops after startup and does not observe ordinary gameplay reads.
The optional `summary: true` marks an overall span. Hosts show only the latest active
summary when no specific running step is visible; independent BIOS and ROM tasks
remain concurrent. Completed rows move above running work in a bounded display.
Indexed project entries share one preparation task per category across successive
file reads, including idle gaps. Adapter readiness closes this phase; completing
one file never announces that the project is ready. File progress still reaches
content consumers unchanged and is not reported as project-wide byte progress.
Hosts may retain a three-row display but must retain hidden active tasks internally.
Readiness remains the mount/restore lifecycle boundary, not a screenshot or title screen.
`LOAD_PROGRESS` remains available for existing consumers.

## Optional content loading preference

`RuntimeHostV1.contentLoading?: "ON_DEMAND" | "PRELOAD"` is a device preference,
not an Envelope resource or Target transport policy. Missing means ON_DEMAND.
PRELOAD prepares the entire managed content set in persistent storage before
mounting the native consumer, emits LOAD_PROGRESS, and holds generation leases
until exit. Storage failure is explicit in this mode; the Host may offer retry
or a switch back to ON_DEMAND. Default optional-cache fallback remains unchanged.
See [Content I/O](content-io.md#explicit-download-before-startup) for source coverage,
validation, cancellation and native-loader boundaries. This optional Host field
does not change the core Reader/bridge ABI or checkpoint formats.

The optional public Target capability `contentLoading` is projected from the
private game input policy: RANGE / ON_OPEN expose `ON_DEMAND_AND_PRELOAD`, EAGER
exposes `PRELOAD_ONLY`, and unmanaged loaders omit it. It is part of the exact
manifest/Envelope/runtime capability comparison. Manifest V2 inputs publish maxFileBytes from the same
Content I/O policy (null for unmanaged inputs); limits apply to each delivered file, including individual
FILE_TREE entries. Bridges and workspace implementation details remain private. Hosts show a choice only for dual-mode Targets, a fixed full
loading indication for preload-only Targets, and no cache controls otherwise.
Product starts resolve device preferences against the actual Launch Target,
including restores and quick starts; unsupported Targets receive no preference.
Preview retains default on-demand behavior. A streaming fallback action is only
valid for dual-mode Targets; fixed/hidden modes must not overwrite device preferences.

### Original content cache ownership

EasyRPG now publishes `contentLoading: ON_DEMAND_AND_PRELOAD`: default game/RTP reads remain lazy and use immutable index identities; explicit PRELOAD commits the complete indexed content before launch. EmulatorJS external BIOS and multi-disc media, and MAME Arcade BIOS bundles, all use the same persistent Content I/O store as ROMs and Parent ROMs. The application does not automatically evict valid original content by age or size. Quota denial follows the existing default-mode fallback and explicit-PRELOAD failure contract.


### Session disc availability

Envelope capabilities remain the exact Target declaration. The runtime instance's `getCapabilities()` describes the current session: `discSwitch` is false when no `MULTI_DISC` resource is present, even for a Target supporting multi-disc games. Other capability fields remain equal to the declaration. No instance may grant undeclared capabilities. Single-disc saves omit a disc index; malformed multi-disc inputs still fail validation.

### Content requirements and native acceptance

Manifest V2 optionally declares closed `contentRequirements` rules and paired
`arcadeDAT` assets. `DECRYPTED_NCSD_NCCH` requires a valid decrypted executable
3DS container. `FLYCAST_CARTRIDGE` binds hardware and a core-owned ROM catalog to
the shipped core digest. FBNeo's `arcadeDAT` binds its exported DAT, core archive
and provenance; the fork exports the DAT from the actual shipped Wasm. Provider
packaging verifies every declared asset and its pairing. Hosts consume verified
facts through their content domain without importing runtime source or starting
a browser during validation. Candidate overrides cannot replace a paired core
without also replacing and validating its catalog or DAT. Full candidate bundles
require every core input to match the declared source digest before any cached
materialization is reused. Loose development overrides remain scoped to the PFB.

Azahar and FBNeo expose a native content-load receipt: zero means pending, one
means accepted, minus one means rejected and minus two means encrypted content. EmulatorJS startup events and frame
counters alone do not complete these Targets' startup barriers. FBNeo's native
error-screen branch returns a failed load. Azahar exposes a separate asynchronous
state-load receipt; startup restore waits for success and fails on rejection,
rather than accepting the wrapper's early callback. The adapter owns these native
details and reports failures through Module V1.

### EmulatorJS download cache retirement

Content I/O is the sole persistent owner of original game, BIOS and Parent content. The pinned 4.2.3 loader uses `EJS_disableDatabases=true`; the pinned 4.3.0-pre loader uses `EJS_cacheConfig.enabled=false`. The obsolete `EJS_CacheLimit` is not configured. These are explicit interfaces of two current releases, not fallback behavior.

Before loading EmulatorJS, its Provider retires only existing `EmulatorJS-Cache`, `EmulatorJS-roms`, `EmulatorJS-bios` and `EmulatorJS-core` download databases. It never deletes native saves, `EmulatorJS-states`, or Content I/O databases. A blocked or unavailable deletion is bounded and reported diagnostically; disabled download caching still prevents old cache contents from being read or duplicated. The Host does not access EmulatorJS storage internals.
