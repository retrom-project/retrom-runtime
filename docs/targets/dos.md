# DOSBox Pure

The `dos` platform and `dosbox_pure` core bind to `emulatorjs/dosbox-pure`. Supply one DOS ZIP/DOSZ bundle containing the executable and its game data. Directory layout and the selected internal program remain part of runtime configuration; selecting a filename outside the archive is invalid.

## Program selection

`dos-entry-candidates` returns sorted, safe archive paths for `.exe`, `.com` and `.bat` members. An explicit `entryPath` selects a real member. With multiple programs and no explicit selection, configuration omits that field and the core can open its own program menu. A replaced bundle is inspected again rather than inheriting an invalid path from the prior archive. See the [offline host tool](../runtime-module.md#offline-host-tool).

Legacy archive names use the runtime's shared ZIP decoding. Where DOS cannot address Unicode paths, the projected archive uses deterministic ASCII 8.3 aliases. Original game bytes and the stored content identity remain unchanged; the host does not rename the source files.

## Browser and loading

This is a threaded EmulatorJS Target and needs cross-origin isolation. The Provider supplies a file-tree index for one projected `game.zip`; the core accesses it through the shared seekable Content I/O bridge. Ordinary loading remains bounded and on demand. Explicit full preload uses the same cache. Do not infer network request sizes from the native bridge's 256 KiB read units.

## Saves and controls

The Target declares `INSTANT` snapshots. Restoration waits for native readiness, quiet pending content reads and a successful native load result before continuing. A cold restore can need more initialization time than a small cartridge. Standard gamepads and keyboard input follow DOSBox's selected game controls; original and pixel video modes are available through the threaded integration.

Source and implementation details: [configuration](../../src/runtime/configure.ts), [native state restore](../../src/providers/emulatorjs/state-restore.ts), [Content I/O boundary](../content-io.md#consumer-boundaries) and [Provider declarations](../../src/providers/emulatorjs/catalog.ts).
