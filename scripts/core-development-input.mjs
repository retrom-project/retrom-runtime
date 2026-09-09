import {lstat, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {sha256} from "./provider-sources.mjs";
export function validCoreDevelopmentInput(value) {
  if (!exact(value, ["id", "repository", "upstreamCommit", "adapterAbi", "assets"]) ||
    !/^[a-z0-9_]{1,64}$/u.test(value.id) || !/^https:\/\/github\.com\/retrom-project\/[A-Za-z0-9._-]+$/u.test(value.repository) ||
    !/^[0-9a-f]{40}$/u.test(value.upstreamCommit) || !/^[a-z0-9-]+$/u.test(value.adapterAbi) ||
    !Array.isArray(value.assets) || value.assets.length < 2 || value.assets.length > 8) {return false;}
  const names = new Set(), outputs = new Set();
  for (const asset of value.assets) {
    if (!exact(asset, ["filename", "output", "maxSizeBytes"]) || !/^[A-Za-z0-9._-]+$/u.test(asset.filename) ||
      !new RegExp(`^(runtime|licenses)/${value.id}/[A-Za-z0-9._-]+$`, "u").test(asset.output) ||
      !Number.isSafeInteger(asset.maxSizeBytes) || asset.maxSizeBytes < 1 || asset.maxSizeBytes > 128 * 1024 * 1024 ||
      names.has(asset.filename) || outputs.has(asset.output)) {return false;}
    names.add(asset.filename); outputs.add(asset.output);
  }
  return value.assets.some((asset) => asset.output.startsWith("licenses/"));
}
export async function stageCoreDevelopmentInput(source, directory, stage) {
  if (!validCoreDevelopmentInput(source) || !directory) {throw new Error("UNPUBLISHED_CORE_INPUT");}
  const descriptor = JSON.parse(await boundedRead(join(directory, "retrom-core-candidate.json"), 65536));
  if (!exact(descriptor, ["schemaVersion", "kind", "coreId", "repository", "branch", "commit", "dirty", "sourceTreeSha256", "adapterAbi", "files"]) ||
    descriptor.schemaVersion !== 1 || descriptor.kind !== "RETROM_CORE_CANDIDATE_V1" || descriptor.coreId !== source.id ||
    descriptor.repository !== source.repository || descriptor.adapterAbi !== source.adapterAbi ||
    !/^[0-9a-f]{40}$/u.test(descriptor.commit) || !/^[0-9a-f]{64}$/u.test(descriptor.sourceTreeSha256) ||
    typeof descriptor.dirty !== "boolean" || typeof descriptor.branch !== "string" || !descriptor.branch ||
    !Array.isArray(descriptor.files) || descriptor.files.length !== source.assets.length) {invalid();}
  const expected = [...source.assets.map((asset) => asset.filename), "retrom-core-candidate.json"].sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expected)) {invalid();}
  const outputs = [];
  for (const asset of source.assets) {
    const file = descriptor.files.filter((entry) => entry.filename === asset.filename);
    if (file.length !== 1 || !exact(file[0], ["filename", "sizeBytes", "sha256"])) {invalid();}
    const bytes = await boundedRead(join(directory, asset.filename), asset.maxSizeBytes);
    if (file[0].sizeBytes !== bytes.length || file[0].sha256 !== sha256(bytes)) {invalid();}
    const target = new URL(asset.output, stage);
    await mkdir(new URL(".", target), {recursive: true}); await writeFile(target, bytes); outputs.push(asset.output);
  }
  return outputs;
}
async function boundedRead(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum) {invalid();}
  return readFile(path);
}
function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function invalid() {throw new Error("CORE_CANDIDATE_INVALID");}
