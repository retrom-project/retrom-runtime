import {createHash} from "node:crypto";
import {lstat, mkdir, mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {isAbsolute, join, parse, relative} from "node:path";

import {buildProviderBundle} from "./provider-bundle.mjs";
import {buildProviderClient} from "./provider-client-build.mjs";

const sourceRepository = "https://github.com/retrom-project/retrom-runtime";

export async function buildRetromRuntimeProviderBundle(input) {
  validateInput(input);
  await createEmptyDirectory(input.outputRoot);
  await assertDirectory(input.stageRoot);

  const assetSources = new Map();
  const assetIndex = {};
  for (const assetPath of uniqueAssetPaths(input.manifest)) {
    const source = join(input.stageRoot, assetPath.replace(/^assets\//u, "runtime/"));
    const contents = await readRegularFile(source);
    assetSources.set(assetPath, source);
    assetIndex[assetPath] = {sha256: sha256(contents), sizeBytes: contents.byteLength};
  }
  const licenseSources = await collectLicenses(input.stageRoot);
  const temporaryRoot = await mkdtemp(join(input.outputRoot, ".provider-client-"));
  try {
    const clientPath = join(temporaryRoot, "client.mjs");
    await buildProviderClient({
      assetIndex,
      entryPoint: input.entryPoint,
      outfile: clientPath,
      targetDigests: targetContractDigests(input.manifest, assetIndex),
    });
    return await buildProviderBundle({
      archiveRoot: input.outputRoot,
      assetSources,
      bundleRoot: join(input.outputRoot, `${input.manifest.providerId}-${input.manifest.providerVersion}`),
      clientModuleBytes: await readFile(clientPath),
      licenseSources,
      manifest: input.manifest,
      provenance: provenance(input),
    });
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
  }
}

export async function buildEmulatorJsProviderBundle(input) {
  validateInput(input);
  validateSourceCatalog(input.sourceCatalog);
  await createEmptyDirectory(input.outputRoot);
  await assertDirectory(input.sourceRoot);
  const assetSources = new Map();
  const assetIndex = {};
  for (const assetPath of uniqueAssetPaths(input.manifest)) {
    const source = join(input.sourceRoot, assetPath.replace(/^assets\//u, ""));
    const contents = await readRegularFile(source);
    assetSources.set(assetPath, source);
    assetIndex[assetPath] = {sha256: sha256(contents), sizeBytes: contents.byteLength};
  }
  verifyEmulatorJsImplementationAssets(input.definition, assetIndex);
  const licenseSources = await collectEmulatorJsLicenses(input.sourceRoot, input.sourceCatalog);
  const temporaryRoot = await mkdtemp(join(input.outputRoot, ".provider-client-"));
  try {
    const clientPath = join(temporaryRoot, "client.mjs");
    await buildProviderClient({
      assetIndex,
      entryPoint: input.entryPoint,
      outfile: clientPath,
      targetDigests: targetContractDigests(input.manifest, assetIndex),
    });
    return await buildProviderBundle({
      archiveRoot: input.outputRoot,
      assetSources,
      bundleRoot: join(input.outputRoot, `${input.manifest.providerId}-${input.manifest.providerVersion}`),
      clientModuleBytes: await readFile(clientPath),
      licenseSources,
      manifest: input.manifest,
      provenance: {
        adapters: input.definition.adapters.map((adapter) => ({
          abi: adapter.abi, id: adapter.id, kind: adapter.kind,
        })).sort((left, right) => compareUtf8(left.id, right.id)),
        build: {tool: "retrom-runtime-provider-build", version: "1"},
        schemaVersion: 1,
        source: {commit: input.commit, repository: sourceRepository, tag: "v0.12.0"},
        overrides: input.sourceCatalog.overrides,
        upstreamReleases: input.sourceCatalog.releases,
      },
    });
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
  }
}

export function targetContractDigests(manifest, assetIndex) {
  if (!manifest || !Array.isArray(manifest.targets) || !assetIndex || typeof assetIndex !== "object") {
    unsafe();
  }
  return Object.fromEntries(manifest.targets.map((target) => {
    if (!target || typeof target.id !== "string" || !Array.isArray(target.assetPaths)) {unsafe();}
    const assetPaths = [...target.assetPaths].sort(compareUtf8);
    if (assetPaths.length !== target.assetPaths.length ||
      assetPaths.some((path, index) => path !== target.assetPaths[index] || index > 0 && path === assetPaths[index - 1])) {
      unsafe();
    }
    const assets = assetPaths.map((path) => {
      const asset = assetIndex[path];
      if (!asset || Object.keys(asset).sort().join("\0") !== "sha256\0sizeBytes" ||
        !/^[0-9a-f]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1) {
        unsafe();
      }
      return {path, sizeBytes: asset.sizeBytes, sha256: asset.sha256};
    });
    return [target.id, sha256(canonicalJsonBytes({schemaVersion: 1, target, assets}))];
  }));
}

function verifyEmulatorJsImplementationAssets(definition, assetIndex) {
  for (const target of definition.targets) {
    const implementation = target.implementation;
    const asset = assetIndex[implementation?.coreAssetPath];
    if (!asset || asset.sha256 !== implementation.coreSha256 ||
      asset.sizeBytes !== implementation.coreSizeBytes) {
      throw new Error("PROVIDER_RELEASE_BUILD_ASSET_MISMATCH");
    }
  }
}

function provenance(input) {
  return {
    adapters: input.definition.adapters.map((adapter) => ({
      abi: adapter.abi,
      id: adapter.id,
      kind: adapter.kind,
    })).sort((left, right) => compareUtf8(left.id, right.id)),
    build: {tool: "retrom-runtime-provider-build", version: "1"},
    schemaVersion: 1,
    source: {
      commit: input.commit,
      repository: sourceRepository,
      tag: `v${input.manifest.providerVersion}`,
    },
  };
}

async function collectLicenses(stageRoot) {
  const result = new Map();
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    const source = join(stageRoot, name);
    await readRegularFile(source);
    result.set(`licenses/retrom-runtime/${name}`, source);
  }
  const root = join(stageRoot, "licenses");
  try {
    await visit(root);
  } catch (error) {
    if (error?.code !== "ENOENT") {throw error;}
  }
  return result;

  async function visit(directory) {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {unsafe();}
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const source = join(directory, entry.name);
      const info = await lstat(source);
      if (info.isSymbolicLink()) {unsafe();}
      if (info.isDirectory()) {await visit(source); continue;}
      if (!info.isFile()) {unsafe();}
      const path = relative(root, source).replaceAll("\\", "/");
      if (!safeRelative(path)) {unsafe();}
      result.set(`licenses/${path}`, source);
    }
  }
}

async function collectEmulatorJsLicenses(sourceRoot, sourceCatalog) {
  const result = new Map();
  for (const release of sourceCatalog.releases) {
    const releaseRoot = join(sourceRoot, release.id);
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES"]) {
      const source = join(releaseRoot, name);
      await readRegularFile(source);
      result.set(`licenses/emulatorjs/${release.id}/${name}`, source);
    }
    const licensesRoot = join(releaseRoot, "licenses");
    await visit(licensesRoot);
    async function visit(directory) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {unsafe();}
      for (const entry of await readdir(directory, {withFileTypes: true})) {
        const source = join(directory, entry.name);
        const child = await lstat(source);
        if (child.isSymbolicLink()) {unsafe();}
        if (child.isDirectory()) {await visit(source); continue;}
        if (!child.isFile()) {unsafe();}
        const path = relative(licensesRoot, source).replaceAll("\\", "/");
        if (!safeRelative(path)) {unsafe();}
        result.set(`licenses/emulatorjs/${release.id}/licenses/${path}`, source);
      }
    }
  }
  return result;
}

function validateSourceCatalog(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.releases) || value.releases.length !== 2 ||
    value.releases.map((release) => release.id).join("\0") !== `4.2.3${"\0"}4.3.0-pre` ||
    !Array.isArray(value.overrides) || value.overrides.length !== 1) {unsafe();}
  for (const release of value.releases) {
    if (!/^[0-9a-f]{40}$/u.test(release.commit) || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-pre)?$/u.test(release.tag) ||
      !release.repository.startsWith("https://") || !/^[0-9a-f]{64}$/u.test(release.archive?.sha256) ||
      !Number.isSafeInteger(release.archive?.sizeBytes) || release.archive.sizeBytes < 1 ||
      release.archive.url !== `${release.repository}/releases/download/${release.tag}/${release.archive.name}`) {unsafe();}
  }
  for (const override of value.overrides) {
    if (!safeRelative(override.destination) || !override.destination.startsWith("4.2.3/data/cores/") ||
      !/^[a-z0-9_]+$/u.test(override.runtimeCore) || !/^[0-9a-f]{64}$/u.test(override.sha256) ||
      !Number.isSafeInteger(override.sizeBytes) || override.sizeBytes < 1 ||
      !/^https:\/\//u.test(override.url) || !/^\d+\.\d+\.\d+$/u.test(override.sourceRelease)) {unsafe();}
  }
}

function uniqueAssetPaths(manifest) {
  const paths = [...new Set(manifest.targets.flatMap((target) => target.assetPaths))].sort(compareUtf8);
  if (!paths.length || paths.some((path) => !path.startsWith("assets/") || !safeRelative(path))) {unsafe();}
  return paths;
}

async function readRegularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {unsafe();}
  const contents = await readFile(path);
  if (!contents.byteLength) {unsafe();}
  return contents;
}

async function assertDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {unsafe();}
}

async function createEmptyDirectory(path) {
  if (!isAbsolute(path) || parse(path).root === path) {unsafe();}
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(path)).length !== 0) {unsafe();}
  } catch (error) {
    if (error?.code !== "ENOENT") {throw error;}
    await mkdir(path, {recursive: true});
  }
}

function validateInput(input) {
  const materializedRoot = input?.stageRoot ?? input?.sourceRoot;
  if (!input || !isAbsolute(input.entryPoint) || !isAbsolute(input.outputRoot) ||
    !isAbsolute(materializedRoot) || !/^[0-9a-f]{40}$/u.test(input.commit) ||
    input.definition.providerId !== input.manifest.providerId ||
    input.definition.providerVersion !== input.manifest.providerVersion) {
    unsafe();
  }
}

function sha256(value) {return createHash("sha256").update(value).digest("hex");}
export function canonicalJsonBytes(value) {return Buffer.from(canonicalJson(value));}
function canonicalJson(value) {
  if (value === null) {return "null";}
  if (typeof value === "boolean" || typeof value === "string") {return JSON.stringify(value);}
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {unsafe();}
    return String(value);
  }
  if (Array.isArray(value)) {return `[${value.map(canonicalJson).join(",")}]`;}
  if (!value || typeof value !== "object") {unsafe();}
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function compareUtf8(left, right) {return Buffer.from(left).compare(Buffer.from(right));}
function safeRelative(value) {return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.includes("?") && !value.includes("#") && !value.includes("\0") && value.split("/").every((part) => part && part !== "." && part !== "..");}
function unsafe() {throw new Error("PROVIDER_RELEASE_BUILD_UNSAFE");}
