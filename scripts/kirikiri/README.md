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
  are recovered from the supplied PE, including file-backed executable tables,
  bounded instruction scheduling and record-preserving callback delegates.
  A connected separated-stream constructor, callback and manager establish the
  availability of the legacy bulk stage. Unsupported compiler shapes return no profile.
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
- `stages.mjs` selects between proven native bulk and sparse stages using each
  complete resource checksum. Conflicting outputs with the same Adler32 fail;
  SHA256 and a second source read verify that stage selection and writing agree.
- `normalize.mjs` declares the registered CxFilterFS plugin, with read-only
  whole-game resource-phase planning and conversion per related archive group.
  A preceding container phase can add patch archives or replace native modules;
  filter discovery inspects both the effective and original modules and still
  requires independent complete-resource checksums to select a candidate. The shared
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

Only bounded protector warning metadata can use short-stream normalization:
its safe name marker, complete raw body, strict Shift-JIS decoding, known notice
prefix, printable characters, nonprotected flags, single raw segment and small
size must all agree. This does not authenticate the entire notice template.
Its original checksum is not
verified; the audit records that loss of source integrity and the corrected
length. Other short resources fail. A Tiny archive whose
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

Hxv4 without a recognized supplied bootstrap remains in the ordinary import/entry
validation flow; this does not establish runtime support. A matched CxFilterFS
plan with unknown parameters,
ambiguous profiles or additional xp3filter scripts fails explicitly. Resource
conversion does not implement game plugins or establish playable/save compatibility.

Algorithm cross-checks: GARbro `KiriKiriCx.cs` at
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0` (MIT), and the independently published
`xp3-brute` 0.3.7 expression grammar (MIT, crate VCS
`eb71626801afd3d86ade797489b984b5cda20582`). The unit vectors use synthetic control
tables and PE files. Private original-package verification is kept outside Git.

Hxv4 archives with the supported supplied PE bootstrap are normalized without
trying to invert filename hashes. `hxv4-pe.mjs` recovers the bres salt, original
startup bytecode, native bootstrap configuration and seed from the source PE.
`hxv4-crypto.mjs` derives the native Argon2i/SHA3/BLAKE2s material and requires
XChaCha20-Poly1305 authentication, exact zlib termination and the complete typed
native table. `hxv4-filter.mjs` interprets the bounded DripValue grammar with
parameters and control words derived from that source; every complete decoded
resource retains its original Adler32 verification and is independently reread.
The immutable input is hashed again after conversion.

The output remains XP3 with all File records in source order and adds the
current internal `RHx4` index chunk: media-name UTF16-unit count (u32LE), media
name UTF16LE, record count (u32LE), then 52-byte records containing exact path
hash (8), file hash (32), source synthetic ID (u32LE), archive slot (u16LE), local
flags (u16LE) and output File index (u32LE). This preserves the full namespace;
a dictionary of guessed names is not a completeness gate. Current support is
unkeyed SipHash-2-4 with little-endian output and BLAKE2s-256 over UTF16LE input
plus the recovered media name. The native unkeyed constructor shape and actual
root/startup namespace must agree. Unknown keyed shapes, nonzero archive slots,
ambiguous bootstrap/profile material, missing/duplicate physical bindings and
additional table data fail. The descriptor selects only the table nonce; the
per-record local flag selects the content filter's open behavior.

The browser core must implement this explicit hash namespace, canonical storage
lookup, directory AutoPath ordering and its true root startup. An ordinary
literal `startup.tjs` can be a protector dummy and must not replace the hashed
root startup. Successful normalization alone does not establish playable/save
compatibility. Hxv4-specific bounded raw warning records use the same explicit
source-integrity-loss audit policy as other protector metadata.
