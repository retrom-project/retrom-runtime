import {createHash} from "node:crypto";
import {lstat, readFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {emulatorJsSourceCatalog} from "../src/providers/emulatorjs/source-catalog.ts";
import {developmentForkFiles, developmentForkSource, stageDevelopmentForks} from "./emulatorjs-development-forks.mjs";

// Explicit, already-built candidates only. This path never compiles a core or changes a catalog.
export async function readPFBProviderCoreFiles(outputRoot, providerId, staging, assetIndex) {
  let selection;
  try {
    selection = JSON.parse((await regular(join(outputRoot, "core-inputs.json"))).toString("utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {return [];}
    throw error;
  }
  if (providerId !== "emulatorjs" || !exact(selection, ["schemaVersion", "cores"]) ||
    selection.schemaVersion !== 1 || !Array.isArray(selection.cores) || selection.cores.length === 0 ||
    new Set(selection.cores.map((core) => core?.id)).size !== selection.cores.length) {invalid();}
  const result = [];
  for (const core of selection.cores) {
    if (!exact(core, ["id", "directory"]) || typeof core.directory !== "string" || !isAbsolute(core.directory)) {invalid();}
    const declared = emulatorJsSourceCatalog.forks.find((fork) => fork.runtimeCore === core.id);
    const source = developmentForkSource(core.id);
    if (!declared || declared.repository !== source.repository || declared.adapterAbi !== source.adapterAbi ||
      !Object.hasOwn(assetIndex, `assets/4.2.3/data/cores/${core.id}-wasm.data`)) {invalid();}
    const descriptorBytes = await regular(join(core.directory, "retrom-core-candidate.json"));
    const descriptor = JSON.parse(descriptorBytes.toString("utf8"));
    if (!Array.isArray(descriptor.files)) {invalid();}
    const fork = {runtimeCore: core.id, repository: source.repository, upstreamCommit: source.upstreamCommit,
      adapterAbi: source.adapterAbi, commit: descriptor.commit, sourceTreeSha256: descriptor.sourceTreeSha256,
      assets: [...descriptor.files, {filename: "retrom-core-candidate.json", sizeBytes: descriptorBytes.length,
        sha256: createHash("sha256").update(descriptorBytes).digest("hex")}]};
    const catalog = {developmentForks: [fork]};
    const destination = join(staging, core.id);
    // Reuse the candidate pipeline's exact metadata, filenames, regular-file and SHA checks.
    await stageDevelopmentForks(catalog, new Map([[core.id, core.directory]]), destination);
    for (const file of developmentForkFiles(catalog)) {
      const path = file.destination.includes("/licenses/") ? `licenses/emulatorjs/${file.destination}` : `assets/${file.destination}`;
      result.push({path, contents: await readFile(join(destination, file.destination))});
    }
  }
  return result;
}

async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 1024 * 1024) {invalid();}
  return readFile(path);
}
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function invalid() {throw new Error("PFB_PROVIDER_CORE_INPUT_INVALID");}
