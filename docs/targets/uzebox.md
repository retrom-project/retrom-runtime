# Uzebox / Uzem

`emulatorjs/uzem` accepts a single `.uze` cartridge for ATmega644 Uzebox, version 1,
using the maintained `retrom-project/libretro-uzem` fork. It exposes an SNES control
layout while loading the Uzem core: standard D-pad, A/B/X/Y, shoulders, Select and Start
map to one native input each. The current core polls player one only.

The fork provides a bounded, versioned complete machine checkpoint including CPU,
RAM, EEPROM, timers, RNG, latched controller input and framebuffer. Public storage uses
one gzip layer, as for other EmulatorJS targets. Restore is cartridge-bound and must
work in a fresh instance. Mouse cartridges, SD media and `.hex` files are excluded.
The source catalog pins `retrom-core-gd991ee94547c-r1`, its commit and every asset
size/SHA-256. Formal aggregation verifies the release descriptor, core, license and
source archive. Local overrides remain restricted to explicit PFB candidates.
