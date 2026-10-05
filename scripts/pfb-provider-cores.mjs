import {createHash} from "node:crypto";
import {lstat, readFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {pathToFileURL} from "node:url";
import {emulatorJsSourceCatalog} from "../src/providers/emulatorjs/source-catalog.ts";
import {developmentForkFiles, developmentForkSource, stageDevelopmentForks} from "./emulatorjs-development-forks.mjs";
import {loadProviderSources} from "./provider-sources.mjs";
import {stageCoreDevelopmentInput, validCoreDevelopmentInput} from "./core-development-input.mjs";
import {emulatorJsCandidateSource, readEmulatorJsCoreCandidate} from "./emulatorjs-core-candidate.mjs";

// Explicit, already-built candidates only. This path never compiles a core or changes a catalog.
export async function readPFBProviderCoreFiles(outputRoot, providerId, staging, assetIndex) {
  let selection;
  try {
    selection = JSON.parse((await regular(join(outputRoot, "core-inputs.json"))).toString("utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {return [];}
    throw error;
  }
  if (!["emulatorjs", "retrom-runtime"].includes(providerId) || !exact(selection, ["schemaVersion", "cores"]) ||
    selection.schemaVersion !== 1 || !Array.isArray(selection.cores) || selection.cores.length === 0 ||
    new Set(selection.cores.map((core) => core?.id)).size !== selection.cores.length) {invalid();}
  const result = [];
  for (const core of selection.cores) {
    if (!exact(core, ["id", "directory"]) || typeof core.directory !== "string" || !isAbsolute(core.directory)) {invalid();}
    if (providerId === "retrom-runtime") {
      result.push(...await readRuntimeCore(core, staging, assetIndex));
      continue;
    }
    const candidateSource = emulatorJsCandidateSource(emulatorJsSourceCatalog, core.id);
    if (candidateSource) {
      const files = await readEmulatorJsCoreCandidate(candidateSource, core.directory, true);
      for (const [output, contents] of files) {
        const path = output.includes("/licenses/") ? `licenses/emulatorjs/${output}` : `assets/${output}`;
        if (!Object.hasOwn(assetIndex, path)) {invalid();}
        result.push({path, contents});
      }
      continue;
    }
    const declared = [...emulatorJsSourceCatalog.forks, ...emulatorJsSourceCatalog.developmentForks]
      .find((fork) => fork.runtimeCore === core.id);
    const source = developmentForkSource(core.id);
    if (!declared || declared.repository !== source.repository || declared.adapterAbi !== source.adapterAbi) {invalid();}
    const descriptorBytes = await regular(join(core.directory, "retrom-core-candidate.json"));
    const descriptor = JSON.parse(descriptorBytes.toString("utf8"));
    if (!Array.isArray(descriptor.files)) {invalid();}
    const fork = {runtimeCore: core.id, repository: source.repository, upstreamCommit: source.upstreamCommit,
      adapterAbi: source.adapterAbi, commit: descriptor.commit, sourceTreeSha256: descriptor.sourceTreeSha256,
      assets: [...descriptor.files, {filename: "retrom-core-candidate.json", sizeBytes: descriptorBytes.length,
        sha256: createHash("sha256").update(descriptorBytes).digest("hex")}]};
    const catalog = {developmentForks: [fork]};
    const candidateFiles = developmentForkFiles(catalog);
    const runtimeFiles = candidateFiles.filter(file => file.filename.endsWith("-wasm.data"));
    if (!runtimeFiles.length || runtimeFiles.some(file => !Object.hasOwn(assetIndex, `assets/${file.destination}`))) {invalid();}
    const destination = join(staging, core.id);
    // Reuse the candidate pipeline's exact metadata, filenames, regular-file and SHA checks.
    await stageDevelopmentForks(catalog, new Map([[core.id, core.directory]]), destination);
    for (const file of candidateFiles) {
      if (file.filename !== `${core.id}-thread-wasm.data` && file.filename !== `${core.id}-wasm.data` &&
        file.filename !== "retrom-core-candidate.json") {continue;}
      const path = file.destination.includes("/licenses/") ? `licenses/emulatorjs/${file.destination}` : `assets/${file.destination}`;
      result.push({path, contents: await readFile(join(destination, file.destination))});
    }
  }
  return result;
}

// A loose core override cannot change the content rules recorded by the base
// manifest. Paired ROM/DAT/catalog updates require a complete provider candidate.
export function requireBaseContentPairs(targets, files) {
  for (const target of targets) {
    const policy = target.contentRequirements;
    const references = [...(policy?.kind === "FLYCAST_CARTRIDGE" ? [policy.catalog, policy.core] : []),
      ...(target.arcadeDAT ? [target.arcadeDAT.asset, target.arcadeDAT.core, target.arcadeDAT.provenance] : [])];
    for (const reference of references) {
      const override = files.find(file => file.path === reference.path);
      if (override && override.sha256 !== reference.sha256) {
        throw new Error("PFB_PROVIDER_CONTENT_PAIR_REQUIRES_BASE_UPDATE");
      }
    }
  }
}

async function readRuntimeCore(core, staging, baseFiles) {
  const catalog = await loadProviderSources(new URL("../", import.meta.url));
  const declared = [...catalog.upstreamReleases, ...catalog.developmentInputs ?? []].find(source => source.id === core.id);
  if (!declared) {invalid();}
  const source = {id: declared.id, repository: declared.repository,
    upstreamCommit: declared.upstreamCommit ?? declared.commit, adapterAbi: declared.adapterAbi,
    assets: declared.assets.map(({filename, output, maxSizeBytes}) => ({filename, output, maxSizeBytes}))};
  if (!validCoreDevelopmentInput(source)) {invalid();}
  const publicPath = output => output.replace(/^runtime\//u, "assets/");
  // Metadata parsers are build tools, excluded from the published Provider's
  // runtime closure. Still validate their bytes as part of the full candidate.
  const publicAssets = source.assets.filter(asset => source.id !== "butterscotch" ||
    !["runtime/butterscotch/butterscotch-meta.mjs", "runtime/butterscotch/butterscotch-meta.wasm"].includes(asset.output));
  if (publicAssets.some(asset => !Object.hasOwn(baseFiles, publicPath(asset.output)))) {invalid();}
  const destination = join(staging, core.id);
  // Validate the complete candidate, including the license, with the same
  // closed file set, ABI, sizes and hashes used by candidate aggregation.
  await stageCoreDevelopmentInput(source, core.directory, pathToFileURL(`${destination}/`));
  return Promise.all(publicAssets.map(async asset => ({
    path: publicPath(asset.output), contents: await readFile(join(destination, asset.output)),
  })));
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
