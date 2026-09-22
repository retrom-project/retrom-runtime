# PC-98 / NP2kai

`retrom-runtime/np2kai-pc98` runs a single HDI hard disk or D88 floppy in a same-origin
blank frame. The maintained NP2kai fork is pinned to upstream commit
`5939e0c6d5985c4c08fc70f289a83290e5d3e6f7` and release `retrom-core-g5939e0c6d598-r1`.
Published assets are pinned by commit, exact size and SHA-256; local PFB overrides remain explicit.

The adapter materializes disks up to 512 MiB with verified size/SHA-256 and reports download
progress. OPFS retains immutable disk bytes across launches. Each instance writes its own
memory copy. `np2kai-state-v1` contains the native execution state and changed 64 KiB disk
blocks, bound to the original disk digest, with a 384 MiB total limit. Fresh launches ignore
previous disk writes unless a checkpoint is explicitly supplied.

Standard gamepads map directions to cursor keys, A to Space (confirm), B to Escape (cancel),
X to Z, Y to X and Start to Enter. Keyboard input remains available. Pause, screenshot,
frame count and instant restore are supported; volume adjustment, disk switching
and external BIOS configuration are outside this trial. A freely distributable Shinonome
font is included in the core build; game bytes are supplied by the host.
Core admission requires standard-gamepad directional movement and confirmation.
Gamepad cancellation is optional; existing working cancellation remains supported.
Within one mapping configuration, each gamepad button has one target input. Do not
send both native A/B and keyboard Enter/Escape to satisfy a menu requirement.
Real keyboard input remains independent. Press/release events for the same target
are one input lifecycle; a host UI's B-to-back behavior is separate from game controls.
