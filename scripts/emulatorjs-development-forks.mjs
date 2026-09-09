import {createHash} from "node:crypto";
import {lstat, readFile, readdir, writeFile, mkdir} from "node:fs/promises";
import {dirname, isAbsolute, join} from "node:path";

const repository = "https://github.com/retrom-project/libretro-cap32";
const baseline = "310cc579b79b6051b378b192224b325a73437c9b";
const names = ["COPYING", "cap32-wasm.data", "retrom-core-candidate.json", "source.tar.gz"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export function validEmulatorJsDevelopmentSource(value) {
  return exact(value, ["id", "repository", "upstreamCommit", "adapterAbi"]) && value.id === "cap32" &&
    value.repository === repository && value.upstreamCommit === baseline && value.adapterAbi === "emulatorjs-state-v1";
}

export function developmentForkFiles(catalog) {
  const forks = catalog.developmentForks ?? [];
  if (!Array.isArray(forks) || forks.length > 1) {invalid();}
  return forks.flatMap((fork) => {
    if (!exact(fork, ["runtimeCore", "repository", "upstreamCommit", "commit", "sourceTreeSha256", "adapterAbi", "assets"]) ||
      !validEmulatorJsDevelopmentSource({id: fork.runtimeCore, repository: fork.repository,
        upstreamCommit: fork.upstreamCommit, adapterAbi: fork.adapterAbi}) ||
      !/^[0-9a-f]{40}$/u.test(fork.commit) || !digest(fork.sourceTreeSha256) || !Array.isArray(fork.assets) ||
      fork.assets.map((file) => file.filename).sort().join("\0") !== names.join("\0")) {invalid();}
    return fork.assets.map((file) => {
      if (!exact(file, ["filename", "sha256", "sizeBytes"]) || !digest(file.sha256) ||
        !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > 16 * 1024 * 1024) {invalid();}
      const destination = file.filename === "cap32-wasm.data" ? "4.2.3/data/cores/cap32-wasm.data"
        : file.filename === "retrom-core-candidate.json" ? "4.2.3/data/cores/reports/cap32.json"
          : `4.2.3/licenses/forks/cap32/${file.filename}`;
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
      (await readdir(directory)).sort().join("\0") !== names.join("\0")) {invalid();}
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
