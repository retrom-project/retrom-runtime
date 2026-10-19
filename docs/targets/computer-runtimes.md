# Apple2JS, jsbeeb and SAM Coupé

These independent browser integrations use one game media resource plus the firmware returned by runtime preparation. They are distinct from the [MAME machine-family Targets](mame-apple2.md), even where they share a product platform.

| Target | Product core | Input | Save semantics |
| --- | --- | --- | --- |
| `apple2-apple2js` | `apple2js` | Apple II disk image supported by the adapter, including DSK/DO/PO, 2MG, NIB and WOZ | `INSTANT` |
| `bbc-jsbeeb` | `jsbeeb` | BBC Micro disk media such as SSD/DSD and the formats selected by its adapter | `INSTANT` |
| `samcoupe` | `samcoupeweb` | SAM `.mgt`, `.dsk` or `.sad` disk image | `GAME_SAVE` |

## Firmware and content

Apple2JS selects its Apple IIe bridge and requires `AppleIIe.rom`, `apple2e-character.rom` and `AppleIIe_DiskII.rom` at their declared virtual paths and sizes. They are not interchangeable with the MAME Apple II+ firmware set. jsbeeb and SAM similarly validate their own external firmware; SAM requires the declared 32 KiB `samcoupe.rom`.

All three Targets use `PRELOAD_ONLY` content loading: verified game and firmware bytes are materialized before the core consumes them. Cache backend and request policy belong to shared [Content I/O](../content-io.md). The broader file-extension catalog is discovery metadata, not a promise that every disk variant or machine expansion is implemented.

## Controls and saves

Standard gamepad support is declared, and the browser runtime retains ordinary keyboard input. Computer software can require additional keys beyond direction and confirmation; test the controls needed by the selected title.

Apple2JS and jsbeeb capture their machine state for restoration into a new instance. SAM exports an identity-bound writable disk image, not CPU state: save progress to the disk inside the game, synchronize it through the host, then use the game's normal boot/load flow in the new instance. An unchanged disk or a read-only medium does not establish saved progress.

Sources: [Apple2JS](../../src/apple2js/adapter.ts), [jsbeeb](../../src/jsbeeb/adapter.ts), [SAM](../../src/samcoupe/adapter.ts), and the [Provider declarations](../../src/providers/retrom-runtime/catalog.ts). Exact public checkpoint formats and capabilities are in the [support catalog](../supported-platforms-and-cores.md).
