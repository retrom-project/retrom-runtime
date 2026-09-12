# EmulatorJS Provider components

## bsnes integration

The optional bsnes target uses the EmulatorJS `v4.3.0-pre` frontend with the immutable
`retrom-core-g4b344745e387-r1` release built by https://github.com/retrom-project/bsnes-libretro from
EmulatorJS/bsnes-libretro commit `4b344745e3878e7c0675a60c624582935524b8f7`.
The fork repairs Asyncify fiber lifecycle and enables Asyncify at link time.
Its pinned RetroArch patch completes asynchronous saves through an explicit
callback, copies state bytes before releasing their native allocation, and
uses owned heap storage for the state metadata. ROM-free regression tests use
real fiber switches and check repeated saves for heap growth.
Its `LICENSE.txt`, source archive and release provenance accompany the Provider.
The core and linked RetroArch include GPL-3.0-or-later and component licenses.

The original 4.3.0-pre prebuilt core is not used: it omitted `co_serializable`
and `co_derive`, and its linker did not enable Asyncify. Its build report did not
record an exact core source commit. The fork baseline above is explicitly pinned
for this integration and is not asserted to be that prebuilt core's revision.
Unpublished core inputs remain restricted to PFB candidate builds.

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

## NeoCD (development candidate)

Source: https://github.com/retrom-project/neocd_libretro, upstream libretro/neocd_libretro
commit `3118c6901787e863e80e79170d02d47657b3b0ab`. The top-level license is LGPL-3.0;
its Z80 component explicitly restricts commercial use. The linked EmulatorJS RetroArch
frontend is GPL-3.0. This is not an unrestricted LGPL-only binary. Candidate bundles
retain original component notices and licenses at
`licenses/emulatorjs/4.2.3/licenses/forks/neocd/LICENSE.md`, alongside `source.tar.gz`.
BIOS and games are supplied separately by the operator.
