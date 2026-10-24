# Host content normalization

`normalize-content` is the host-only boundary used before entry configuration,
content identity and the host's shared STORE packager. No conversion module is
imported by a browser adapter, TJS VM or engine loader. The host first receives
an owned copy; mounted originals, patches, metadata and covers stay read-only.

`registry.mjs` is the complete explicit registration list. A plugin declares a
stable `id`, positive integer implementation `version`, `platforms`, supported
`formats`, and numeric `priority`. Lower priority runs first, then UTF-8 ID order.
Adding a format requires a plugin and a registration, without changing import
or packaging. Parameters must come from supplied structures, indexes or static
modules; editable titles never select behavior.

- `probe(context)` only reads the complete game's file facts and locators. It
  returns an empty array when unmatched, or plans for archives/related groups.
  Each plan declares its format, consumed `claims` and complete output paths.
  A per-operation cache shares bounded XP3 and static-module inspection.
- `convert(context, plan)` writes standard resources below this operation's
  fresh `outputRoot` and returns exact file facts and validation counts. It does
  not write ZIPs, publish managed content or clean arbitrary directories.

The pipeline probes all registrations and validates all plans before converting.
Overlapping input claims, competing output paths or writes over retained files
raise `RUNTIME_NORMALIZATION_CONFLICT`; registration order cannot hide a conflict.
Malformed matched structures, missing filter parameters, ambiguous parameters,
conversion errors and manifest mismatches stop the operation. They never become
an unmatched fallback. If every plugin is unmatched, the original facts continue
through ordinary entry recognition, validation, identity and STORE packaging;
unmatched is neither import failure nor a claim of playable support.

Plans cover the whole game rather than stopping after its first protected file.
The CxFilterFS plugin groups related XP3s by table format and salt, confirms the
filter for each group, and preserves every outer archive path. Ordinary XP3,
unhandled variants and unrelated files retain their bytes. Base/patch archives
remain separate so their engine-defined overlay order is preserved. Shared XP3,
bounded locator, path, digest and static-PE helpers own common format primitives.

A bounded CPU Worker performs probes and conversion without loading DAT or
executing native files. The parent owns the fresh directory, waits for worker
termination on error/cancel, and removes only that directory. Late cancellation
during termination is checked before returning success. The host rechecks staged
facts, packages once, durably publishes and switches references atomically; its
existing retirement and upload-cleanup policies remain authoritative.

The bounded normalization receipt records source TREE hash, plugin ID/version,
formats, source/output size and SHA, independently verified output count, resource
validation counts and explicit metadata exceptions. Temporary detailed audits
are not game files. Content/save identity uses actual output path/size/SHA only,
never a converter version; a converter upgrade does not touch existing games.

The fork's Python offline front end calls this same packaged `normalize-content`
command, with an explicitly supplied tool path. Python owns reception and shared
STORE publication, and contains no independent decoding/filter implementation.

The generic host command scheduler separately bounds conversion admission,
waiting and execution. See [host protocol](../../docs/runtime-module.md) for
budgets; a Worker alone does not isolate interactive command slots.
