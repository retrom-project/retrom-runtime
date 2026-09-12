# EmulatorJS Provider components

## Flycast integration

Flycast WASM and its linked EmulatorJS RetroArch frontend are GPL-2.0-or-later and GPL-3.0-or-later respectively. Their license texts accompany the pinned core release. The source fork is https://github.com/retrom-project/flycast-wasm.

The CHD cache uses @noble/hashes 2.0.1 (https://github.com/paulmillr/noble-hashes), under the following MIT license:

The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## VecX

Source: https://github.com/retrom-project/libretro-vecx, based on
https://github.com/libretro/libretro-vecx at 8f671cc9d737f2890c3ce19e177e2984dcae121f.
VecX is GPL-3.0; the PSG component retains its MIT notice in `vecx_psg.c` and
`vecx_psg.h`. The core release includes the original `LICENSE.md` and complete
source archive, including component notices. EmulatorJS RetroArch linker source
is pinned by the fork build recipe. Release: `retrom-core-g8f671cc9d737-r1`.
