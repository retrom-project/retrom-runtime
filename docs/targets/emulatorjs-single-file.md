# EmulatorJS Single-File Cores

The EmulatorJS Provider adds Fuse, Gearcoleco, PrBoom, PUAE, VICE x128/x64sc/xvic and
Virtual Jaguar as separate single-file targets. These targets have no multi-disc
capability. Their fixed input sources are declared in `src/providers/emulatorjs/source-catalog.ts`:
six use the official 4.2.3 assets; only VICE xvic and Virtual Jaguar use Retrom fork releases.
The fork records pin repository, annotated tag, commit, adapter ABI, archive, metadata and license.
The downloaded metadata must agree with every pinned asset hash and size. `artifactSetSha256`
for a fork target identifies that pinned metadata file. Hashes establish cache integrity;
the release workflow and commit identify the build source.

Fuse enables direct keyboard input and configures controller one as Kempston, with controller two
disabled to avoid competing joystick ports. Its standard pad uses the libretro controls, including
Space/Return shoulder buttons for keyboard-oriented title menus. Instant restore retains the
minified 4.2.3 loader, enables native state diagnostics internally, and waits for the asynchronous
native load callback and its error result. Exit runs EmulatorJS's native cleanup before disposal.
New core admission still requires a real host import, preview, product launch, visible input
response and checkpoint restore into a fresh instance; passing serialization alone is insufficient.

SAME CD-i configures both digital pointer increments to 20 through its native
MAME machine configuration before startup. This keeps both movement signs above
games' pointer quantization threshold while preserving native button sequences
and physical mouse sensitivity. The same configuration applies before checkpoint
restoration; PAL execution remains 50 Hz.

The SAME_CDI release uses the maintenance baseline of EmulatorJS/same_cdi at
`cfb05d803f54130adf94efef88edd816d01df7a3`, with MAME CDIC startup and sound-map
restart timing backports. Its immutable release descriptor, complete source archive and COPYING
are pinned in the source catalog. Compare audio after a fresh boot: an older checkpoint
can retain the guest audio driver state responsible for periodic interruptions.
