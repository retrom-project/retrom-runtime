#!/usr/bin/env bash
set -euo pipefail

runtime_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_root=$(mktemp -d "${TMPDIR:-/tmp}/retrom-runtime-ons.XXXXXX")
cleanup() {
  rm -rf -- "$source_root"
}
trap cleanup EXIT

read_manifest() {
  node --input-type=module -e '
    import {readFileSync} from "node:fs";
    const manifest=JSON.parse(readFileSync(process.argv[1], "utf8"));
    const value=manifest.sourceBuilds.find((item)=>item.id==="onsyuri")?.[process.argv[2]];
    if(typeof value!=="string" || !value) process.exit(1);
    process.stdout.write(value);
  ' "$runtime_root/runtime-manifest.json" "$1"
}

repository=$(read_manifest repository)
tag=$(read_manifest tag)
commit=$(read_manifest commit)
patch_path=$(read_manifest patch)
git clone --quiet --depth 1 --branch "$tag" "$repository" "$source_root/source"
actual_commit=$(git -C "$source_root/source" rev-parse HEAD)
if [[ "$actual_commit" != "$commit" ]]; then
  echo "ONS_SOURCE_COMMIT_MISMATCH" >&2
  exit 1
fi
git -C "$source_root/source" apply --check "$runtime_root/$patch_path"
git -C "$source_root/source" apply "$runtime_root/$patch_path"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env EMSDK_HOME=/emsdk \
  --env EMSDK_QUIET=1 \
  --env HOME=/tmp/ons-home \
  --volume "$source_root/source:/source" \
  --workdir /source/script \
  emscripten/emsdk:4.0.8 \
  bash -lc 'mkdir -p "$HOME" /source/build_web && export EMSDK_HOME=/emsdk && ./cross_web.sh'

output="$runtime_root/build/ons"
mkdir -p "$output"
install -m 0644 "$source_root/source/build_web/onsyuri.js" "$output/onsyuri.js"
install -m 0644 "$source_root/source/build_web/onsyuri.wasm" "$output/onsyuri.wasm"
install -m 0644 "$source_root/source/src/onsyuri/COPYING" "$output/COPYING"
printf 'ons-core: %s at %s\n' "$tag" "$commit"
