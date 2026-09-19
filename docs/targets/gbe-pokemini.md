# Pokémon Mini / GBE+

The target `retrom-runtime/gbe-pokemini` runs one 8.25 KiB–2 MiB
`.min` ROM with a separately supplied 4 KiB `bios.min`. Its fork is
[retrom-project/gbe-plus](https://github.com/retrom-project/gbe-plus), based on
upstream commit `05a05e931b3993ff3e6316b0d841a1fb4d3ac7a7`.
The source catalog pins the immutable `retrom-core-g05a05e931b39-r1` release,
commit, ABI and exact asset sizes/SHA-256. Formal builds verify the release descriptor
and every downloaded byte. Local overrides remain restricted to explicit PFB candidates.

A standard gamepad maps the D-pad/left stick to directions, A/B/X to Mini A/B/C,
LB to Shake, and Select to Power. Keyboard arrows and Z/X/D/C/Space remain usable.
Pause, exit and blur release held keys. Native instantaneous CPU/MMU/APU/LCD
snapshots are bound to the ROM SHA-256 and checked for integrity, then compressed
once by the shared Provider storage boundary as `gbe-pokemini-state-v1-storage-v1`
(maximum 1 MiB). ROM and BIOS bytes use verified persistent Cache Storage across
instances. The target supports screenshots, volume and frame counting; infrared
multiplayer and native configuration UI are outside this target.
