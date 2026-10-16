# ShiinaRio / OpenShiina

The candidate `shiina-rio` Target uses the OpenShiina fork's `openshiina-web-v1`
interface. The fork owns the shared C# interpreter, codecs, portable guest memory,
Skia renderer, browser worker and reproducible browser archive. This adapter owns
Content I/O, standard gamepad cursor, input ownership, lifecycle and native saves.
No Windows executable is executed in the browser.

`SHIINA_PROJECT` selects `RIO.INI`; its directory becomes the project root. Supply
an installed game tree with its executable (for scheme identification), WAR archives,
patch archives and loose movies. An installer or disc image is not an installed tree.
Game editions and encryption keys must match an OpenShiina scheme; renamed executables
and translation patches do not establish compatibility.

The first acceptance scope is Sorcery Jokers, Japanese edition with its v1.01 patch,
in desktop Chrome. The Chinese edition of Damatte Watashi no Muko ni Nare tested for
this integration has not passed archive/script decoding. Other games, engine versions,
mobile browsers and Safari require separate acceptance.

Game streams use the public Content I/O session and stable project/path identities.
Each engine read is at most 64 KiB; the common reader may coalesce or prefetch bounded
network windows. No WAR archive is eagerly materialized. `PRELOAD` uses the same
public persistent store, verifies all project files before boot, reports progress,
keeps leases until exit and fails explicitly if full caching cannot complete.

The browser uses a dedicated .NET WASM worker, OffscreenCanvas and a 64 KiB shared
read mailbox. It requires cross-origin isolation. Managed decoding is single-threaded;
no x86 JIT is used. Large file offsets remain exact. Desktop OpenShiina retains its
original mapped-file and virtual-address-space backends.

`shiina-game-save-v1` is a bounded 64 MiB native-file container; the public Provider
boundary applies its single gzip storage layer. It includes every native save byte,
file hashes and the project identity. Sorcery Jokers manual slots `sjs_save_000.bin`
through `sjs_save_099.bin` establish progress. Global settings and the startup
continuation `sjs_save_103.bin` do not make checkpoint capture available. Save admission
for another game requires identifying and testing that game's actual progress files.

Use the game's SAVE menu first, then synchronize in the Host. A new Launch imports
these files before boot; use the game's LOAD menu and continue playing. This is
`GAME_SAVE`, with in-game capture and restore, rather than an instant snapshot.
The adapter never invents a progress file or exports settings as progress.

Standard gamepad directions move the shared pointer; A sends left mouse, B sends
right mouse; LB slows pointer movement. Physical keyboard input remains separate.
Pause, blur and exit release held inputs; exit cancels readers, terminates the worker,
removes listeners and closes audio. Rendering remains at the game's original dimensions.

The source declaration remains an explicit development input until the fork has an
immutable published Release. PFB candidates verify the exact closed archive, source,
license and ABI. No candidate worktree path or digest belongs in a production lock.
