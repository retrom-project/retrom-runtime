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
