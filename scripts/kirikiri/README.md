# Kiri import normalization

The host's `normalize-content` command calls this server-side module before
configuration and content identity calculation. It converts supported archive
representations, independently of the browser engine. No game-name branch,
game bytes, extracted control table, native execution or x86 emulator is shipped.

- `xp3.mjs` reads bounded XP3 indexes and CxFilterFS name tables. Logical names
  use ASCII-only case folding and the archive's optional UTF16 title salt.
- `cxdec-pe.mjs` discovers supported PE32 constructor/generator relationships
  and bounded embedded modules. Unsupported compiler shapes return no profile.
- `cxdec.mjs` interprets a bounded expression grammar instead of generated x86.
- `convert.mjs` streams decompressed resources through the selected filter and
  independently rereads every ordinary output resource before success.
- `import.mjs` owns the fresh temporary root and a cancellable CPU worker.
  Cancellation waits for worker termination before reclaiming that root.

Parameters must be recovered from the supplied archive/modules and uniquely
confirmed against complete resource samples. Input SHA, output SHA, lengths,
checksums, index bounds and zlib termination remain checked. The resource filter
uses absolute uncompressed offsets, including cross-boundary/split reads.

The name table defines the protected logical namespace. Literal physical decoys
outside it are recorded rather than exposed as competing startup scripts.
Unlinked hashed names indicate an incomplete table and fail conversion.

Only the protector's warning metadata can use the verified native short-stream
behavior: its name marker, raw body marker, nonprotected flags, raw segments and
small size must all agree. Other short resources fail. A Tiny archive whose
multiple complete protected records all use one seed is reported as having
seed-only source checksum metadata. Each mismatch remains an explicit exception;
the output gets a recomputed checksum and digest. These are not source-integrity
passes and still require project acceptance.

`normalization` includes bounded counts and exception details for the host's
existing diagnostic log, without absolute locators or game configuration state.
The detailed temporary `.audit-*` JSONL is intentionally not a game member.
The host clears its own intermediate packages after successful publication and
never removes external mounted Pegasus metadata or original packages.

Hxv4 is recognized but rejected with `RUNTIME_KIRIKIRI_NAMES_UNAVAILABLE` until
complete logical names can be recovered. Unknown filters/parameters, ambiguous
profiles and additional xp3filter scripts are unsupported. Resource conversion
does not implement game plugins or establish playable/save compatibility.

Algorithm cross-checks: GARbro `KiriKiriCx.cs` at
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0` (MIT), and the independently published
`xp3-brute` 0.3.7 expression grammar (MIT, crate VCS
`eb71626801afd3d86ade797489b984b5cda20582`). The unit vectors use synthetic control
tables and PE files. Private original-package verification is kept outside Git.
