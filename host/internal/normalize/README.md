# Host content normalization

`normalize-content` is the host-only boundary used before entry configuration,
content identity and the host's shared STORE packager. No conversion code is
part of a browser adapter, TJS VM or engine loader. The host first receives
an owned copy; mounted originals, patches, metadata and covers stay read-only.

`Registry` in `run.go` is the complete explicit registration list. A plugin
(`pipeline.Plugin`) declares a stable `ID`, positive integer implementation
`Version`, `Platforms`, supported `Formats`, `Phase` (`container` or `resource`)
and numeric `Priority`. Containers expand first. Within each phase, lower
priority runs first, then UTF-8 ID order. Adding a format requires a plugin and a
registration, without changing import or packaging. Parameters must come from
supplied structures, indexes or static modules; editable titles never select
behavior.

| ID | Phase | Package |
| --- | --- | --- |
| `molebox4-steelbox` | container | `molebox*.go` |
| `enigma-protector-vfs` | container | `enigma*.go` |
| `xmoe-psb` | container | `xmoe*.go` |
| `electron-asar`, `nw-embedded-zip` | container | `web.go` |
| `kirikiri-cxfilterfs`, `kirikiri-hxv4` | resource | [`../kirikiri`](../kirikiri/README.md) |

- `Probe(context)` only reads the complete game's file facts and locators. It
  returns no plans when unmatched, or plans for archives/related groups.
  Each plan declares its format, consumed `Claims` and complete output paths.
  Container plans can explicitly declare existing files in `Overrides`; each
  must have a replacement output. Undeclared writes over retained files fail.
  A launcher declares its claimed file as `LaunchDomain`. Multiple independent
  launch domains fail before conversion rather than combining their payloads.
  A per-phase cache shares bounded XP3 and static-module inspection.
- `Convert(context, plan)` writes standard resources below this operation's
  private phase `OutputRoot` and returns exact file facts and validation counts.
  Detailed temporary logs can use the separate request-owned `AuditRoot` and
  never enter the game file manifest. Plugins do not write ZIPs, publish managed
  content or clean arbitrary directories.

The pipeline probes all registrations in a phase and validates its plans before
converting. The resource phase receives the resulting effective file facts and
bounded locators, so embedded XP3 files pass through the same resource converters
as external files. Its `Original` view retains immutable reception facts and
locators for filter discovery when an overlay replaces a native module. Original
modules are evidence only; they do not replace the active overlaid files.
Overlapping input claims, competing output paths or writes over retained files
raise `RUNTIME_NORMALIZATION_CONFLICT`; registration order cannot hide a conflict.
Malformed matched structures, missing filter parameters, ambiguous parameters,
conversion errors and manifest mismatches stop the operation. They never become
an unmatched fallback. If every plugin is unmatched, the original facts continue
through ordinary entry recognition, validation, identity and STORE packaging;
unmatched is neither import failure nor a claim of playable support.

Plans cover the whole game rather than stopping after its first protected file.
The KiriKiri container plugin recognizes the supported PE32 Molebox 4/STEELBOX
loader vocabulary. It derives the substitution table, header fields, stage and
catalog password from connected loader structures, validates catalog/package
CRC32 and the complete named VFS tree, and checks every extracted block's CRC16.
Embedded packages follow their native mount order; later entries shadow earlier
entries. Files retain their paths relative to the executable, the original EXE
retains its bytes, and unrelated external siblings remain present. Additional
DLL/registry injection, external dynamic mounts, hidden nodes and conditional
physical-file fallback fail explicitly. Other loader shapes need their own
format evidence; recognizing an EXE never authorizes executing its Windows code.
Container metadata does not establish which XP3 the original engine selects.
Reviewers use the existing entry configuration for the intended startup file;
resource extraction alone does not establish playable support.

The Enigma Protector VFS adapter recognizes a connected PE32 bootstrap and
its bounded self-XOR stages. It derives the master configuration key from the
supplied PE sections, verifies both configuration digests, and decodes its
aPLib data. External mount masks come from the loader's IDEA-encrypted dynamic
configuration. The importer resolves only those masks within the executable's
default folder; it does not scan arbitrary companion files by extension.

Embedded and configured external packages retain their native stable descending
timestamp order. The first virtual same-name file wins, and an action-zero
virtual file overrides its physical sibling. Original executables and mounted
packages retain their bytes. The decoder handles the native per-record state
reset, 8192-byte raw blocks and indexed 65536-byte compressed blocks. Paths,
counts, expansion, block ranges and stream termination are bounded. DWORD
zero padding is accepted only for the bootstrap's aligned XOR input.

The supported boundary excludes disk-export actions, COM registration and
paths outside the executable domain; recognized unsupported metadata fails.
Package publisher signatures are parsed as counted fields but are not
authenticated; configuration digest checks do not establish publisher identity.
The subsequent resource phase independently checks XP3 resources and converts
their protection normally. No native executable, DLL or protection VM runs
during import. A converted container alone does not establish engine/plugin,
language or save compatibility.

The X'moe PSB container adapter recognizes connected PE32 code structures for
the companion resource name, index XORs, filename hash, payload key and text
rotation. Bounded candidates can recover an additive section representation;
the adapter validates independent code/table references rather than executing
the protection VM or identifying a game. It verifies the complete CHuffman
index, names and payload ranges, decodes bounded LZ4 blocks, and rebuilds marked
PSB v2 strings as standard UTF-8 while preserving non-text sections. Other
native patch mechanisms require separate format evidence.

Converted scripts live under a distinct `.runtime-patches/` directory. The
original module, companion package and base resources remain present. A bounded
`.runtime-launches/` manifest binds source and generated file facts. Runtime
configuration selects a unique recognized patch through the existing explicit
`overlayRoot` option; reviewers can select original resources or a patch as a
separate launch scheme without changing the project entry. Alternative resources
remain separate, so selection precedes the effective resource view, and switching
these schemes does not require another conversion. Manifest discovery validates
paths, complete resource membership, size and SHA-256; a present DLL or successful
launch is not proof of translation. Multiple independent container domains remain
an explicit import ambiguity. Native file-blocking hooks are not guessed from
archive names or applied to unrelated content.

Case-insensitive container paths fold with the JavaScript `toUpperCase`/`toLowerCase`
mapping (`rules.Upper`/`rules.Lower`), including unconditional special casing.

Probes and conversion run in the caller's goroutine without loading DAT or
executing native files, and observe the request context for cancellation.
Intermediate files use a separate owned workspace, so an in-place logical rewrite
cannot truncate its input. Once both phases succeed, only final files are moved to
the host's flat `outputRoot` paths. `Normalize` creates both fresh directories and
reclaims the workspace plus any failed or cancelled request output before it
returns. A raised format failure becomes a stable reason code, and any other
failure becomes `RUNTIME_NORMALIZATION_FAILED`. The host rechecks staged facts,
packages once, durably publishes and switches references atomically; its existing
retirement and upload-cleanup policies remain authoritative.

The bounded normalization receipt records source TREE hash, plugin ID/version,
formats, source/output size and SHA, independently verified output count, resource
validation counts and explicit metadata exceptions. Container receipts include
overridden inputs and a `CONTAINER_FILE_OVERRIDE` detail with both size/digest
pairs. Temporary detailed audits are not game files. Content/save identity uses
actual output path/size/SHA only, never a converter version; a converter upgrade
does not touch existing games.

Admission and concurrency belong to the embedding server; see the
[host module contract](../../../docs/host-module.md). Conversion has a one-hour
command deadline independent of interactive commands.
