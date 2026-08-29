#!/usr/bin/env bash
set -euo pipefail

runtime_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$runtime_root/.cache/tmp" "$runtime_root/.cache/toolchains"
source_root=$(mktemp -d "$runtime_root/.cache/tmp/kirikiri-source.XXXXXX")
cleanup() {
  rm -rf -- "$source_root"
}
trap cleanup EXIT

read_manifest() {
  node --input-type=module -e '
    import {readFileSync} from "node:fs";
    const manifest=JSON.parse(readFileSync(process.argv[1], "utf8"));
    const value=manifest.sourceBuilds.find((item)=>item.id==="kirikiri2")?.[process.argv[2]];
    if(typeof value!=="string" || !value) process.exit(1);
    process.stdout.write(value);
  ' "$runtime_root/runtime-manifest.json" "$1"
}

prepare_emsdk() {
  local destination=$1
  if [[ ! -x "$destination/emsdk" ]]; then
    rm -rf -- "$destination"
    git clone --quiet --depth 1 --branch 4.0.23 https://github.com/emscripten-core/emsdk.git "$destination"
  fi
  if [[ ! -f "$destination/upstream/emscripten/emcc.py" ]]; then
    "$destination/emsdk" install 4.0.23
    "$destination/emsdk" activate 4.0.23
  fi
}

prepare_vcpkg() {
  local destination=$1
  local expected=b1e15efef6758eaa0beb0a8732cfa66f6a68a81d
  if [[ ! -d "$destination/.git" ]]; then
    rm -rf -- "$destination"
    git clone --quiet https://github.com/microsoft/vcpkg.git "$destination"
    git -C "$destination" checkout --quiet "$expected"
  fi
  if [[ "$(git -C "$destination" rev-parse HEAD)" != "$expected" ]]; then
    echo "KIRIKIRI_VCPKG_COMMIT_MISMATCH" >&2
    exit 1
  fi
  if [[ ! -x "$destination/vcpkg" ]]; then
    "$destination/bootstrap-vcpkg.sh" -disableMetrics
  fi
}

repository=$(read_manifest repository)
commit=$(read_manifest commit)
patch_path=$(read_manifest patch)
git -C "$source_root" init --quiet source
git -C "$source_root/source" remote add origin "$repository"
git -C "$source_root/source" fetch --quiet --depth 1 origin "$commit"
git -C "$source_root/source" checkout --quiet --detach FETCH_HEAD
git -C "$source_root/source" submodule update --init --recursive --depth 1
actual_commit=$(git -C "$source_root/source" rev-parse HEAD)
if [[ "$actual_commit" != "$commit" ]]; then
  echo "KIRIKIRI_SOURCE_COMMIT_MISMATCH" >&2
  exit 1
fi
git -C "$source_root/source" apply --check "$runtime_root/$patch_path"
if [[ "${KIRIKIRI_PATCH_CHECK_ONLY:-false}" == "true" ]]; then
  echo "kirikiri-core-patch: $commit"
  exit 0
fi
git -C "$source_root/source" apply "$runtime_root/$patch_path"

emsdk_root=${EMSDK:-$runtime_root/.cache/toolchains/emsdk-4.0.23}
vcpkg_root=${VCPKG_ROOT:-$runtime_root/.cache/toolchains/vcpkg-b1e15efef675}
prepare_emsdk "$emsdk_root"
prepare_vcpkg "$vcpkg_root"
source "$emsdk_root/emsdk_env.sh" >/dev/null
export VCPKG_ROOT="$vcpkg_root"

(cd "$source_root/source" && cmake --preset "Web Release Config")
embuilder build sdl2 sdl2_ttf sdl2-mt sdl2_ttf-mt
cmake --build "$source_root/source/out/web/release" --parallel "${KIRIKIRI_BUILD_JOBS:-2}"

output="$runtime_root/build/kirikiri"
mkdir -p "$output"
for asset in index.js index.wasm vlfs.js assets.zip; do
  install -m 0644 "$source_root/source/out/web/release/$asset" "$output/$asset"
done
install -m 0644 "$source_root/source/LICENSE" "$output/LICENSE"
printf 'kirikiri-core: %s\n' "$commit"
