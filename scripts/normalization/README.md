# Host content normalization

`normalize-content` is the host-only boundary used before entry configuration,
content identity and the host's shared STORE packager. No conversion module is
imported by a browser adapter, TJS VM or engine loader. The host first receives
an owned copy; mounted originals, patches, metadata and covers stay read-only.

`registry.mjs` is the complete explicit registration list. A plugin declares a
stable `id`, positive integer implementation `version`, `platforms`, supported
`formats`, `phase` (`container` or `resource`) and numeric `priority`. Containers
expand first. Within each phase, lower priority runs first, then UTF-8 ID order.
Adding a format requires a plugin and a registration, without changing import
or packaging. Parameters must come from supplied structures, indexes or static
modules; editable titles never select behavior.

- `probe(context)` only reads the complete game's file facts and locators. It
  returns an empty array when unmatched, or plans for archives/related groups.
  Each plan declares its format, consumed `claims` and complete output paths.
  Container plans can explicitly declare existing files in `overrides`; each
  must have a replacement output. Undeclared writes over retained files fail.
  A launcher declares its claimed file as `launchDomain`. Multiple independent
  launch domains fail before conversion rather than combining their payloads.
  A per-phase cache shares bounded XP3 and static-module inspection.
- `convert(context, plan)` writes standard resources below this operation's
  private phase `outputRoot` and returns exact file facts and validation counts.
  Detailed temporary logs can use the separate request-owned `auditRoot` and
  never enter the game file manifest. Plugins do not write ZIPs, publish managed
  content or clean arbitrary directories.

The pipeline probes all registrations in a phase and validates its plans before
converting. The resource phase receives the resulting effective file facts and
bounded locators, so embedded XP3 files pass through the same resource converters
as external files. Its `original` view retains immutable reception facts and
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

The KiriKiri plugin groups related CxFilterFS XP3s by table format and salt, confirms the
filter for each group, and preserves every outer archive path. It also handles
authenticated fixed-XOR/native filters in ordinary-name XP3s and bounded PE
overlays; see [Kiri import normalization](../kirikiri/README.md). Ordinary XP3,
unhandled variants and unrelated files retain their bytes. Base/patch archives
remain separate so their engine-defined overlay order is preserved. Shared XP3,
bounded locator, path, digest and static-PE helpers own common format primitives.

A bounded CPU Worker performs probes and conversion without loading DAT or
executing native files. Intermediate files use a separate owned workspace, so
an in-place logical rewrite cannot truncate its input. Once both phases succeed,
only final files are moved to the host's flat `outputRoot` paths. The parent owns
both fresh directories, waits for worker termination on error/cancel, and reclaims
the workspace plus any failed request output. Late cancellation
during termination is checked before returning success. The host rechecks staged
facts, packages once, durably publishes and switches references atomically; its
existing retirement and upload-cleanup policies remain authoritative.

The bounded normalization receipt records source TREE hash, plugin ID/version,
formats, source/output size and SHA, independently verified output count, resource
validation counts and explicit metadata exceptions. Container receipts include
overridden inputs and a `CONTAINER_FILE_OVERRIDE` detail with both size/digest
pairs. Temporary detailed audits
are not game files. Content/save identity uses actual output path/size/SHA only,
never a converter version; a converter upgrade does not touch existing games.

The fork's Python offline front end calls this same packaged `normalize-content`
command, with an explicitly supplied tool path. Python owns reception and shared
STORE publication, and contains no independent decoding/filter implementation.

The generic host command scheduler separately bounds conversion admission,
waiting and execution. See [host protocol](../../docs/runtime-module.md) for
budgets; a Worker alone does not isolate interactive command slots.
