# Kiri import normalization

The host's `normalize-content` command calls this server-side module before
configuration and content identity calculation. It converts supported archive
representations, independently of the browser engine. No game-name branch,
game bytes, extracted control table, native execution or x86 emulator is shipped.

- `xp3.mjs` reads bounded XP3 indexes and CxFilterFS name tables. Logical names
  from `eliF`, `hnfn`, `Yuzu`, `neko` and `sen:` use ASCII-only case folding and
  the archive's optional UTF16 title salt.
- `cxdec-pe.mjs` discovers supported PE32 constructor/generator relationships
  and bounded embedded modules. Legacy extraction callbacks are identified by
  their record ABI, seed field, mask/add boundary, paired region consumer and
  high-word fold. Their generator's direct table reference and complete grammar
  are recovered from the supplied PE. Unsupported compiler shapes return no profile.
- `pe-xp3.mjs` recognizes a bounded XP3 overlay after valid PE sections, within
  the original logical source slice. It preserves the outer logical filename;
  the converted file is an ordinary XP3 and becomes an entry candidate through
  its signature. Reviewers still select the intended entry when needed.
- `ordinary.mjs` inspects ordinary-name archives. Fixed XOR requires a unique
  byte key authenticated by three distinct complete resource checksums. Classic
  and Tiny filters use the supplied native modules, including clear modules in
  a PE's XP3 overlay, and independent checksummed archive resources.
- `cxdec.mjs` interprets a bounded expression grammar instead of generated x86.
  Tiny profiles describe bulk XOR and an optional additional XOR at absolute
  resource byte zero, with independent zero-key fallbacks. Dual-key recovery
  connects the constructor's fields to its offset-aware consumer through the
  PE vtable; constants and both fallbacks come from that supplied module.
- `convert.mjs` streams decompressed resources through the selected filter and
  independently rereads every ordinary output resource before success.
- `normalize.mjs` declares the registered CxFilterFS plugin, with read-only
  whole-game planning and conversion per related archive group. The shared
  [normalization pipeline](../normalization/README.md) owns the fresh root,
  cancellable CPU worker, plan conflict checks and output-manifest verification.

Parameters must be recovered from the supplied archive/modules and uniquely
confirmed against complete resource samples. Input SHA, output SHA, lengths,
checksums, index bounds and zlib termination remain checked. The resource filter
uses absolute uncompressed offsets, including cross-boundary/split reads.
Profile deduplication includes the first-byte behavior and low constant byte,
so equal bulk keys cannot hide conflicting first-byte candidates.

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

Ordinary archives whose multiple records all have clear flags and zero seeds
also lack decoded checksums. They require a filter independently authenticated
by at least three distinct checksummed resources elsewhere in the project.
`resource-format.mjs` chooses between clear and decoded bytes only when a complete
supported representation is unambiguous: PNG chunk CRCs, Ogg page CRCs, a valid
PE mapping, or strictly decoded UTF-8/UTF-16 text without unexpected controls.
This bounded path preserves clear bootstrap scripts/modules, records every
resource as corrected source metadata, and writes real output checksums. It
does not treat format evidence as validation of the missing source checksum.

`normalization` includes bounded counts and exception details for the host's
existing diagnostic log, without absolute locators or game configuration state.
The detailed temporary `.audit-*` JSONL is intentionally not a game member.
The host clears its own intermediate packages after successful publication and
never removes external mounted Pegasus metadata or original packages.

Hxv4 has no registered converter until complete logical names can be recovered.
It is retained for the ordinary import/entry validation flow; this does not
establish runtime support. A matched CxFilterFS plan with unknown parameters,
ambiguous profiles or additional xp3filter scripts fails explicitly. Resource
conversion does not implement game plugins or establish playable/save compatibility.

Algorithm cross-checks: GARbro `KiriKiriCx.cs` at
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0` (MIT), and the independently published
`xp3-brute` 0.3.7 expression grammar (MIT, crate VCS
`eb71626801afd3d86ade797489b984b5cda20582`). The unit vectors use synthetic control
tables and PE files. Private original-package verification is kept outside Git.
