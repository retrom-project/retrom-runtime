import {createHash} from "node:crypto";
import {lstat, readFile, readdir} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {forkReleaseFiles} from "./emulatorjs-fork-releases.mjs";

const sources = {
"flycast": {"repository": "https://github.com/retrom-project/flycast-wasm", "adapterAbi": "emulatorjs-flycast-state-v1", "outputs": {"LICENSE": "4.2.3/licenses/forks/flycast/LICENSE", "flycast-rom-requirements.json": "4.2.3/data/cores/flycast-rom-requirements.json", "flycast-wasm.data": "4.2.3/data/cores/flycast-wasm.data", "flycast.json": "4.2.3/data/cores/reports/flycast.json"}},
"fbneo": {"repository": "https://github.com/retrom-project/FBNeo", "adapterAbi": "emulatorjs-content-result-v1", "outputs": {"LICENSE": "4.2.3/licenses/forks/fbneo/LICENSE", "fbneo-arcade.dat": "4.2.3/data/cores/fbneo-arcade.dat", "fbneo-content-pair.json": "4.2.3/data/cores/fbneo-content-pair.json", "fbneo-wasm.data": "4.2.3/data/cores/fbneo-wasm.data", "fbneo.json": "4.2.3/data/cores/reports/fbneo.json"}},
"azahar": {"repository": "https://github.com/retrom-project/azahar", "adapterAbi": "emulatorjs-content-result-v1", "outputs": {"LICENSE": "4.3.0-pre/licenses/forks/azahar/LICENSE", "azahar-thread-wasm.data": "4.3.0-pre/data/cores/azahar-thread-wasm.data", "azahar.json": "4.3.0-pre/data/cores/reports/azahar.json"}}
};
export function validEmulatorJsCoreSource(source) {
 const identity = sources[source?.id];
 return Boolean(identity) && exactKeys(source, ["adapterAbi", "files", "id", "repository"]) && source.repository === identity.repository &&
  source.adapterAbi === identity.adapterAbi && Array.isArray(source.files) && source.files.length > 0 &&
  source.files.length === Object.keys(identity.outputs).length && new Set(source.files.map(file => file.filename)).size === source.files.length &&
  source.files.every(file => exactKeys(file, ["filename", "output", "sha256", "sizeBytes"]) &&
   Object.hasOwn(identity.outputs, file.filename) && identity.outputs[file.filename] === file.output && safePath(file.output) &&
   Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 && file.sizeBytes <= 32 * 1024 * 1024 && /^[a-f0-9]{64}$/u.test(file.sha256));
}

export async function readEmulatorJsCoreCandidate(source, directory, candidate) {
  if (!candidate) {throw new Error("UNPUBLISHED_CORE_INPUT");}
  if (!validEmulatorJsCoreSource(source) || !isAbsolute(directory ?? "")) {throw invalid();}
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {throw invalid();}
  const descriptor = JSON.parse((await regular(join(directory, "retrom-core-candidate.json"))).toString("utf8"));
  if (!exactKeys(descriptor, ["adapterAbi", "branch", "commit", "coreId", "dirty", "files", "kind",
    "repository", "schemaVersion", "sourceTreeSha256"]) || descriptor.schemaVersion !== 1 || descriptor.kind !== "RETROM_CORE_CANDIDATE_V1" ||
    descriptor.coreId !== source.id || descriptor.repository !== source.repository ||
    descriptor.adapterAbi !== source.adapterAbi || !/^[a-f0-9]{40}$/u.test(descriptor.commit) ||
    !/^[a-f0-9]{64}$/u.test(descriptor.sourceTreeSha256) || typeof descriptor.dirty !== "boolean" ||
    !/^(?:feat|fix|build|sync)\/[a-zA-Z0-9/._-]+$/u.test(descriptor.branch) ||
    !Array.isArray(descriptor.files) || descriptor.files.length !== source.files.length ||
    !descriptor.files.every((file) => exactKeys(file, ["filename", "sha256", "sizeBytes"]))) {throw invalid();}
  const names = [...source.files.map((file) => file.filename), "retrom-core-candidate.json"].sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(names)) {throw invalid();}
  const result = new Map();
  for (const file of source.files) {
    const pinned = descriptor.files.find((entry) => entry.filename === file.filename);
    const bytes = await regular(join(directory, file.filename));
    if (!pinned || !Number.isSafeInteger(pinned.sizeBytes) || pinned.sizeBytes < 1 ||
      pinned.sizeBytes > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/u.test(pinned.sha256) ||
      bytes.length !== pinned.sizeBytes || hash(bytes) !== pinned.sha256) {throw invalid();}
    result.set(file.output, bytes);
  }
  return result;
}

// Full bundles pin their declarations and all paired assets. Loose PFB overrides
// deliberately use readEmulatorJsCoreCandidate instead.
export async function readPinnedEmulatorJsCoreCandidate(source, directory, candidate) {
  const files = await readEmulatorJsCoreCandidate(source, directory, candidate);
  for (const file of source.files) {
    const bytes = files.get(file.output);
    if (!bytes || bytes.length !== file.sizeBytes || hash(bytes) !== file.sha256) {
      throw new Error("EMULATORJS_CORE_CANDIDATE_DECLARATION_MISMATCH");
    }
  }
  return files;
}

async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 32 * 1024 * 1024) {throw invalid();}
  return readFile(path);
}
function safePath(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._/-]+$/u.test(value) && !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}
function hash(value) {return createHash("sha256").update(value).digest("hex");}
function invalid() {return new Error("EMULATORJS_CORE_CANDIDATE_INVALID");}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

export function emulatorJsCoreInputs(catalog, directories = {}, candidate = false) {
  const developmentCores = [...catalog.developmentCores ?? []];
  const forks = (catalog.forks ?? []).filter((fork) => {
    if (!Object.hasOwn(directories, fork.runtimeCore)) {return true;}
    if (!candidate) {throw new Error("UNPUBLISHED_CORE_INPUT");}
    const source = {id: fork.runtimeCore, repository: fork.repository, adapterAbi: fork.adapterAbi,
      files: forkReleaseFiles({forks: [fork]}).filter((file) => file.filename !== "rpg-runtime-release.json")
        .map(({filename, destination, sizeBytes, sha256}) => ({filename, output: destination, sizeBytes, sha256}))};
    if (!validEmulatorJsCoreSource(source)) {throw invalid();}
    developmentCores.push(source);
    return false;
  });
  return {...catalog, forks, developmentCores};
}
