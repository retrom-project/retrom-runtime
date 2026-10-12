# FBAlpha 0.2.97.44 candidate acceptance

The new `emulatorjs/fbalpha/arcade` target passed scoped product acceptance in the independent `fbalpha-029744` PFB. This adds one row to the product matrix: 111 targets, 110 bindings, 95 platforms and 123 product rows. Historical rows retain their original evidence and status; top-level R10 snapshot fields do not identify this supplemental candidate.

## Implementation and identity

- Core fork: `retrom-project/fbalpha`, upstream `libretro/beetle-finalarcade2019` at `b25b724ba204`; candidate core commit `8ab6a13b68ef201a15b8009a26f57026c76c9e60`.
- Runtime implementation `9111b38`; paired candidate source tree `974251a11ee39d188890a328b3e2787d175782ac888af593523a32ff836785ea`.
- Final core archive SHA-256 `18ea6e0b352f757323602b856514a4955d99766c4c0a72df7eb2e457120373a4`; raw Wasm `d13166b22a11b88440fae80fde824e3f583d0c2c372188516d4a1d9b94cbec5c`.
- Observed core fingerprint `839d0dd54d37ef9bded6781dfd5e9a8ec915768fcf9a6eb42ec279d82aa79a02`; served EmulatorJS module SHA-256 `0dc6f8ed90b64fd0636932de5565c614a80c20a9e2a20ccfe8d91b028b15a242`.
- DAT is exported from the shipped Wasm: 5,807 entries, including eight BIOS entries. Native content-result receipts, shared per-core DAT selection, Parent cleanup, arcade input and checkpoint adapters are reused. Instance-scoped arcade-family registration keeps original ZIPs intact.

Fixed SDK, frontend source, version metadata and hash-pinned single-threaded 7-Zip 25.01 make all five CI and PFB assets byte-identical. The [independent core build](https://github.com/retrom-project/fbalpha/actions/runs/38284823116) passed. No per-ROM aliases, patches or driver modifications were introduced.

## Product evidence

Twenty-one authorized original Pegasus samples were scanned, previewed, manually approved and played through the public product path. Every sample entered gameplay and responded to standard Gamepad API coin/start/direction/action input. Mounted ROM digests matched the sources. Neo Geo and PGM BIOS were installed through normal upload and supplied independently; no bytes were rewritten. All samples satisfied mandatory members; 81 CRC warnings remained visible for manual review. Automatic BIOS scanning skipped these archives and is not claimed as an installation pass.

Representative `captcomm` produced a 10,225-byte checkpoint during real battle. Different Run and cookie-only fresh Chromium restoration preserved the battle scene and character; paused observation for seven seconds and subsequent movement/attack passed. With ordinary HTTP cache disabled, a complete 2,541,859-byte OPFS object passed SHA-256 assurance and the warm instance made zero ROM requests. Offline input, download cancellation and explicit storage-quota failure feedback also passed.

Manual FBA DAT selection and isolation from FBNeo, MAME 2003, MAME 2003 Plus and MAME current were checked through normal review configuration. Existing FBNeo 1941 passed actual flight/movement/shooting regression. Temporary regression content and obsolete test saves were removed; the 21 games and the final verified save remain available in the PFB.

Evidence collection `retrom-fbalpha-029744-20261013/` includes raw attempts, screenshots, native receipts, cache diagnostics and build gates. Its final `report.json` SHA-256 is `6314ecb1b2ab2020712c194f75e6d50a8594fdf694334bc3c3e540fc76d73f89`. Full gameplay used the same unpacked JS/Wasm as the final archive; all 21 native loads and representative save/cache semantics were repeated after compressor pinning.

Runtime lint/typecheck and 312 files / 1,816 tests passed at implementation commit `6829f9b`. The subsequent correction only changes the pinned archive length; final candidate build and package closure verified the corrected bytes, all 24 upstream inputs and 1,265 package files. Core native-receipt and four release-contract tests, PFB verification and workspace catalog validation passed.

## Scope and release boundary

This covers short real gameplay on 21 samples and representative checkpoint/cache semantics, not full-game completion, every FBA game or physical-controller/mobile/4K acceptance. Initial development reload/iframe interruptions and harness selector failures remain in raw records; isolated reruns passed. Headless SwiftShader readback-performance warnings and existing Next/iframe/unpack-worker warnings remain; no final core load or console errors were observed.

This is an unpublished development candidate. Formal delivery still requires an immutable core release, exact runtime release pins, a paired runtime release and Retrom pin verification. No release tag, PR, merge, database change or production deployment was performed by this integration.
