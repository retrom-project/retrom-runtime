import {createHash} from "node:crypto";
import {lstat, readFile, readdir, writeFile, mkdir} from "node:fs/promises";
import {dirname, isAbsolute, join} from "node:path";

const sources = new Map([
  ["vecx", {repository: "https://github.com/retrom-project/libretro-vecx",
    upstreamCommit: "8f671cc9d737f2890c3ce19e177e2984dcae121f", license: "LICENSE.md"}],

  ["quasi88", {repository: "https://github.com/retrom-project/quasi88-libretro",
    upstreamCommit: "459bbc6e90caa3dc392ae8e64a9b0881b1e5ef77", license: "LICENSE"}],
  ["bsnes", {repository: "https://github.com/retrom-project/bsnes-libretro",
    upstreamCommit: "4b344745e3878e7c0675a60c624582935524b8f7", license: "LICENSE.txt", release: "4.3.0-pre"}],
  ["same_cdi", {repository: "https://github.com/retrom-project/same_cdi",
    upstreamCommit: "cfb05d803f54130adf94efef88edd816d01df7a3", license: "COPYING"}],
  ...["vice_xpet", "vice_xplus4"].map((core) => [core, {repository: "https://github.com/retrom-project/vice-libretro",
    upstreamCommit: "1b4309f4d56ded7bfc5ad7ba8d5a9a44ac3388a8", license: "COPYING"}]),
  ["81", {repository: "https://github.com/retrom-project/81-libretro",
    upstreamCommit: "86decf3ee61ea5803972948e80197bee8474796b", license: "LICENSE"}],
  ["cap32", {repository: "https://github.com/retrom-project/libretro-cap32",
    upstreamCommit: "310cc579b79b6051b378b192224b325a73437c9b", license: "COPYING"}],
  ["crocods", {repository: "https://github.com/retrom-project/libretro-crocods",
    upstreamCommit: "be00fb904da08d66221017f6708508298f17ff07", license: "LICENSE"}],
]);
const names = (core) => [sources.get(core)?.license, `${core}-wasm.data`, "retrom-core-candidate.json", "source.tar.gz"].sort();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export function validEmulatorJsDevelopmentSource(value) {
  const source = sources.get(value?.id);
  return !!source && exact(value, ["id", "repository", "upstreamCommit", "adapterAbi"]) &&
    value.repository === source.repository && value.upstreamCommit === source.upstreamCommit && value.adapterAbi === "emulatorjs-state-v1";
}

export function developmentForkFiles(catalog) {
  const forks = catalog.developmentForks ?? [];
  if (!Array.isArray(forks) || forks.length > sources.size || new Set(forks.map((fork) => fork?.runtimeCore)).size !== forks.length) {invalid();}
  return forks.flatMap((fork) => {
    if (!exact(fork, ["runtimeCore", "repository", "upstreamCommit", "commit", "sourceTreeSha256", "adapterAbi", "assets"]) ||
      !validEmulatorJsDevelopmentSource({id: fork.runtimeCore, repository: fork.repository,
        upstreamCommit: fork.upstreamCommit, adapterAbi: fork.adapterAbi}) ||
      !/^[0-9a-f]{40}$/u.test(fork.commit) || !digest(fork.sourceTreeSha256) || !Array.isArray(fork.assets) ||
      fork.assets.map((file) => file.filename).sort().join("\0") !== names(fork.runtimeCore).join("\0")) {invalid();}
    return fork.assets.map((file) => {
      if (!exact(file, ["filename", "sha256", "sizeBytes"]) || !digest(file.sha256) ||
        !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > 16 * 1024 * 1024) {invalid();}
      const release = sources.get(fork.runtimeCore).release ?? "4.2.3";
      const destination = file.filename === `${fork.runtimeCore}-wasm.data` ? `${release}/data/cores/${file.filename}`
        : file.filename === "retrom-core-candidate.json" ? `${release}/data/cores/reports/${fork.runtimeCore}.json`
          : `${release}/licenses/forks/${fork.runtimeCore}/${file.filename}`;
      return {...file, destination, runtimeCore: fork.runtimeCore};
    });
  });
}

export function requireDevelopmentForkMode(catalog, allowed) {
  if (developmentForkFiles(catalog).length && !allowed) {throw new Error("UNPUBLISHED_CORE_INPUT");}
}

export function verifyDevelopmentForkMetadata(fork, metadata) {
  if (!exact(metadata, ["schemaVersion", "kind", "coreId", "repository", "branch", "commit", "dirty",
    "sourceTreeSha256", "adapterAbi", "files"]) || metadata.schemaVersion !== 1 ||
    metadata.kind !== "RETROM_CORE_CANDIDATE_V1" || metadata.coreId !== fork.runtimeCore ||
    metadata.repository !== fork.repository || metadata.adapterAbi !== fork.adapterAbi ||
    metadata.commit !== fork.commit || metadata.sourceTreeSha256 !== fork.sourceTreeSha256 ||
    typeof metadata.dirty !== "boolean" || !/^(?:feat|fix|build)\/[a-z0-9-]+$/u.test(metadata.branch) ||
    !Array.isArray(metadata.files) || metadata.files.length !== 3) {invalid();}
  for (const asset of fork.assets.filter((file) => file.filename !== "retrom-core-candidate.json")) {
    const file = metadata.files.find((entry) => entry.filename === asset.filename);
    if (!exact(file, ["filename", "sha256", "sizeBytes"]) || file.sha256 !== asset.sha256 ||
      file.sizeBytes !== asset.sizeBytes) {invalid();}
  }
}

export async function stageDevelopmentForks(catalog, roots, destinationRoot) {
  const files = developmentForkFiles(catalog);
  for (const fork of catalog.developmentForks ?? []) {
    const directory = roots?.get(fork.runtimeCore);
    if (typeof directory !== "string" || !isAbsolute(directory)) {invalid();}
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
      (await readdir(directory)).sort().join("\0") !== names(fork.runtimeCore).join("\0")) {invalid();}
    for (const file of files.filter((entry) => entry.runtimeCore === fork.runtimeCore)) {
      const source = join(directory, file.filename);
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes) {invalid();}
      const bytes = await readFile(source);
      if (hash(bytes) !== file.sha256) {invalid();}
      if (file.filename === "retrom-core-candidate.json") {
        verifyDevelopmentForkMetadata(fork, JSON.parse(bytes.toString("utf8")));
      }
      const output = join(destinationRoot, file.destination);
      await mkdir(dirname(output), {recursive: true});
      await writeFile(output, bytes);
    }
  }
}
function invalid() {throw new Error("EMULATORJS_DEVELOPMENT_FORK_INVALID");}
