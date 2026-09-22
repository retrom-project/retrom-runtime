# PC-88 / QUASI88

The `quasi88` EmulatorJS target accepts raw D88/U88 media through the host catalog.
It defaults to N88 V2 with keyboard input enabled. Standard D-pad directions send
numeric keypad movement; the primary face button sends Return through native Start.
The swapped Start/primary bindings remain one-to-one. Checkpoints use
`emulatorjs-state-v1-storage-v1`; no multi-disc capability is declared.
Seven NEC firmware files are external dependencies in the core system `quasi88/` directory.
The adapter sets `system_directory` explicitly before native startup, so the pinned
RetroArch linker does not fall back to the content directory.
The source catalog pins the immutable fork release and all asset digests.
PC-88 games can require additional keyboard controls: The Librarian uses keypad
7/9/4/6/1/3 for hex movement, while the generic D-pad sends 8/2/4/6.
Product acceptance belongs to the host; a single sample does not establish the complete
PC-88 compatibility matrix.
