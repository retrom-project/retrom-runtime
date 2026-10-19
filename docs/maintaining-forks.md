# Maintaining Upstream Forks

The Player `master`, mkxp-z Web `main`, ONScripterYuri `master`, KiriKiri Web `web`, Butterscotch `main`,
TyranoScript `master` and WASM-4 `main`
branches are unmodified, fast-forward-only upstream mirrors. Retrom changes live on one active
`retrom/<baseline>` branch per fork, which is also that fork's default branch.
Each fork records its exact tagged or commit-only upstream baseline in a root
`retrom-fork.json`. Work starts from the active baseline on short-lived
`fix/*`, `feat/*`, `build/*`, or `sync/upstream-*` branches and is merged back
before a release tag is created. A moving upstream mirror is never merged into
a fixed release baseline.

Fork releases use only `retrom-core-<upstream-baseline>-rN` tags. For a new
upstream without a tag, the baseline token is `g` plus 12 hexadecimal commit
characters; the release metadata still records the full commit. Tags and
assets are immutable, and aliases such as `latest`, `stable`, and the retired
`rpg-runtime-*` and `retrom-web-*` namespaces are not supported. This aggregate repository pins the
fork repository, stable tag, tag commit, filenames, and adapter ABI.

## Candidate asset closures

Release pins live in [provider-sources.json](../provider-sources.json) and the [EmulatorJS source catalog](../src/providers/emulatorjs/source-catalog.ts). Normal Provider builds download and verify those fixed release assets. Local PFB core candidates are explicit development inputs and do not change release pins or Target declarations.

The ONS checkpoint-ready JavaScript binding is checked against the actual Wasm export before packaging. Its pinned release must provide that ABI; an adapter default cannot substitute for it.

For Butterscotch upstream-sync validation, candidates include their metadata parser pair for integrity verification, but only the game runner and license override the installed Provider. The metadata tools are outside its public asset closure. EasyRPG candidates use the existing two-file JS/Wasm release contract; the installed Provider retains its separately collected license notices.
