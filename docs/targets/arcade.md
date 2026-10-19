# Arcade ROM sets and MAME Current

The `arcade` platform has separate core bindings for FBNeo, FBAlpha 0.2.97.44, FBA2012 CPS1/CPS2, MAME2003, MAME2003 Plus and MAME Current. Their game sets, firmware requirements and save formats are selected from their own declarations and paired facts; a ZIP that works with one core is not automatically valid for another.

## Content preparation

Choose the actual ROM set using the selected core's runtime DAT projection. Entry ZIPs, required Parent ZIPs and installed BIOS/device firmware stay separate, with their original bytes and declared virtual filenames. A complete merged game archive can supply required ROM members, while firmware ownership remains separately declared.

The host uses `rom-sets`, `batch-content-bios-requirements` and normal preparation results to inspect these facts. Missing required members or wrong sizes are structural errors. Named members of the expected size with differing CRCs are review warnings for an operator decision; a successful inspection or optional trial launch does not prove full gameplay compatibility. See [runtime configuration](../runtime-module.md#arcade-review-crc-warnings).

## MAME Current

`mame_arcade` binds to `retrom-runtime/mame-arcade`, using the same maintained dylink runtime as the [MAME computer/console families](mame-apple2.md). It requires Wasm threads and cross-origin isolation. The runtime prepares the explicit `machine` option from the selected set; the host does not guess a machine from an editable game title.

This Target accepts DAT-declared CHD dependencies in addition to ZIP members. Preparation discovers the required logical media paths, and the Worker reads CHD media through bounded shared Content I/O. ZIP and firmware resources have their own materialization limits. Full preload is an explicit managed-content option, not the default for all CHD bytes.

Its `INSTANT` checkpoint includes native execution state and the session's `diff/` and `nvram/` files where present, binding them to the selected machine and content. Restoring requires the matching media resources as well as the snapshot; copying a base CHD or NVRAM file alone does not reproduce execution state.

## Other arcade hardware

[Flycast NAOMI / NAOMI 2 / Atomiswave](flycast-arcade.md), [NeoCD](neocd.md), [Daphne](daphne.md) and Supermodel have separate platform/Target entries and content rules. Their presence in the catalog does not add those formats to every `arcade` core. Supermodel uses the `model3` platform and its own ZIP input; follow the generated catalog and core preparation facts for that binding.

Sources: [DAT and dependency projection](../../src/runtime/arcade.ts), [CHD media planning](../../src/runtime/arcade-media.ts), [MAME declarations](../../src/providers/retrom-runtime/mame-declaration.ts), and [Worker snapshot files](../../src/mame/worker-state.ts).
