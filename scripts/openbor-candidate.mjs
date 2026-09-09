import {lstat, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {sha256} from "./provider-sources.mjs";

const filenames = ["LICENSE", "LICENSES.txt", "openbor.mjs", "openbor.wasm"];
export function asOpenBORCandidateSource(release) {
  const source = {id: release?.id, repository: release?.repository, upstreamCommit: release?.upstreamCommit,
    adapterAbi: release?.adapterAbi, assets: release?.assets?.map(({filename, output, maxSizeBytes}) =>
      ({filename, output, maxSizeBytes}))};
  if (!validOpenBORSource(source)) {throw invalid();}
  return source;
}

export function validOpenBORSource(source) {
  return exact(source, ["id", "repository", "upstreamCommit", "adapterAbi", "assets"]) &&
    source.id === "openbor" && source.repository === "https://github.com/retrom-project/openbor" &&
    /^[0-9a-f]{40}$/u.test(source.upstreamCommit) && source.adapterAbi === "openbor-host-v1" &&
    Array.isArray(source.assets) && source.assets.length === filenames.length && source.assets.every((asset, i) =>
      exact(asset, ["filename", "output", "maxSizeBytes"]) && asset.filename === filenames[i] &&
      asset.output === output(filenames[i]) && asset.maxSizeBytes === maximum(filenames[i]));
}

/** Aggregate explicit fork-owned bytes; this module never compiles or fetches a core. */
export async function stageOpenBORCandidate(source, directory, stage) {
  if (!directory) {throw new Error("UNPUBLISHED_CORE_INPUT");}
  if (!validOpenBORSource(source)) {throw invalid();}
  const descriptor = JSON.parse(await bounded(join(directory, "retrom-core-candidate.json"), 65536));
  if (!exact(descriptor, ["schemaVersion", "kind", "coreId", "repository", "branch", "commit", "dirty",
    "sourceTreeSha256", "adapterAbi", "files"]) || descriptor.schemaVersion !== 1 ||
    descriptor.kind !== "RETROM_CORE_CANDIDATE_V1" || descriptor.coreId !== source.id ||
    descriptor.repository !== source.repository || descriptor.adapterAbi !== source.adapterAbi ||
    !/^[0-9a-f]{40}$/u.test(descriptor.commit) || !/^[0-9a-f]{64}$/u.test(descriptor.sourceTreeSha256) ||
    typeof descriptor.dirty !== "boolean" || typeof descriptor.branch !== "string" || !descriptor.branch ||
    !Array.isArray(descriptor.files) || descriptor.files.length !== filenames.length) {throw invalid();}
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([...filenames, "retrom-core-candidate.json"].sort())) {throw invalid();}
  const verified = [];
  for (const [i, file] of descriptor.files.entries()) {
    if (!exact(file, ["filename", "sizeBytes", "sha256"]) || file.filename !== filenames[i] ||
      !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > maximum(file.filename) ||
      !/^[0-9a-f]{64}$/u.test(file.sha256)) {throw invalid();}
    const bytes = await bounded(join(directory, file.filename), maximum(file.filename));
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw invalid();}
    verified.push([output(file.filename), bytes]);
  }
  for (const [path, bytes] of verified) {
    const target = new URL(path, stage);
    await mkdir(new URL(".", target), {recursive: true}); await writeFile(target, bytes);
  }
  return verified.map(([path]) => path);
}
function output(name) {return name.startsWith("LICENSE") ? `licenses/openbor/${name}` : `runtime/openbor/${name}`;}
function maximum(name) {return name === "openbor.wasm" ? 67108864 : 4194304;}
function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
async function bounded(path, maximumBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximumBytes) {throw invalid();}
  return readFile(path);
}
function invalid() {return new Error("OPENBOR_CANDIDATE_INVALID");}
