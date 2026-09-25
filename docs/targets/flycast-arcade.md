# Flycast arcade cartridges

The `flycast-naomi`, `flycast-naomi2`, and `flycast-atomiswave` Targets share
the verified Flycast WASM core, adapter, WebGL2, standard gamepad mapping, and
bounded instant checkpoint contract used by the Dreamcast Target. The
product bindings and BIOS requirements are separate so a game launches with
the right platform and firmware snapshot.

Each Target accepts one MAME-style cartridge ZIP as opaque game content.
The filename must be the Flycast machine name, such as `pstone2.zip`,
`wldrider.zip`, or `ggisuka.zip`. The adapter keeps that filename when handing
the validated game Blob to EmulatorJS; using a content digest as the filename
would make Flycast's cartridge table lookup fail. The adapter bypasses
EmulatorJS 4.2.3's automatic ROM extraction for these ZIPs, and the Target
disables automatic CUE generation so Flycast receives the ZIP itself.

Required firmware is mounted through the external-file resource:

| Target | File in Flycast system directory |
| --- | --- |
| `flycast-naomi` | `dc/naomi.zip` |
| `flycast-naomi2` | `dc/naomi2.zip` |
| `flycast-atomiswave` | `dc/awbios.zip` |

This cartridge path does not pair GD-ROM ZIPs with CHD images, nor resolve
parent/clone ROM archives. Those inputs need their own import grouping and
external-file delivery before they can be declared supported.
