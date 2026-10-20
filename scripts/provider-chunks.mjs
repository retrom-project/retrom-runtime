import {createHash} from "node:crypto";
import {lstat, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {deterministicTarGz, providerBundleSha256, readDeterministicTarGz} from "./provider-bundle.mjs";

/** A planned chunk above this size is split by deeper directories; a single larger file stays whole. */
export const CHUNK_LIMIT_BYTES = 32 * 1024 * 1024;
const emulatorJsCore = /^(assets\/[^/]+\/data\/cores)\/([^/]+)$/u;
const digest = /^[0-9a-f]{64}$/u;

/**
 * Stable grouping key for one bundle path. Unchanged content keeps its group across
 * releases, so its chunk identity and archive bytes stay identical.
 */
export function chunkGroup(path) {
  const parts = path.split("/");
  if (parts[0] === "licenses") {
    const fork = parts.indexOf("forks");
    return fork >= 0 && fork + 2 < parts.length ? parts.slice(0, fork + 2).join("/") : "licenses";
  }
  if (parts[0] !== "assets" || parts.length < 3 || parts[1] === "content-io") {return "";}
  const core = emulatorJsCore.exec(path);
  if (core) {return `${core[1]}/${core[2].split(/[-.]/u, 1)[0]}`;}
  return `assets/${parts[1]}`;
}

/** Partition integrity entries ({path, sizeBytes, sha256}) into content-addressed chunks. */
export function planProviderChunks(files) {
  const groups = new Map();
  for (const file of files) {
    if (!safeRelative(file.path) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 ||
      !digest.test(file.sha256)) {invalid();}
    const key = chunkGroup(file.path);
    groups.set(key, [...groups.get(key) ?? [], file]);
  }
  const chunks = [...groups].flatMap(([key, members]) => split(members, key ? key.split("/").length : 0));
  return chunks.map(describe).sort((left, right) => compare(left.chunkId, right.chunkId));
}

function split(files, depth) {
  const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (total <= CHUNK_LIMIT_BYTES || files.length === 1) {return [files];}
  const deeper = new Map();
  for (const file of files) {
    const key = file.path.split("/").slice(0, depth + 1).join("/");
    deeper.set(key, [...deeper.get(key) ?? [], file]);
  }
  if (deeper.size === 1 && [...deeper.keys()][0] === files[0].path) {return [files];}
  return [...deeper.values()].flatMap((members) => split(members, depth + 1));
}

function describe(files) {
  const sorted = [...files].sort((left, right) => compare(left.path, right.path));
  const identity = sorted.map((file) => [file.path, file.sizeBytes, file.sha256]);
  return {
    chunkId: sha256(Buffer.from(JSON.stringify(identity))),
    files: sorted.map(({path, sha256: hash, sizeBytes}) => ({path, sha256: hash, sizeBytes})),
    unpackedSizeBytes: sorted.reduce((sum, file) => sum + file.sizeBytes, 0),
  };
}

/** Writes `<provider>-chunk-<id>.tar.gz` archives and `<provider>-chunks-<version>.json`. */
export async function chunkProviderBundle({bundleRoot, providerId, providerVersion, outputRoot}) {
  const bundleSha256 = await providerBundleSha256(bundleRoot);
  const integrityBytes = await readFile(join(bundleRoot, "integrity.json"));
  const integrity = JSON.parse(integrityBytes.toString("utf8"));
  const files = [...integrity.files.map(({path, sha256: hash, sizeBytes}) => ({path, sha256: hash, sizeBytes})),
    {path: "integrity.json", sha256: sha256(integrityBytes), sizeBytes: integrityBytes.byteLength}];
  await mkdir(outputRoot, {recursive: true});
  const chunks = [];
  for (const chunk of planProviderChunks(files)) {
    const entries = await Promise.all(chunk.files.map(async (file) => [file.path, await readFile(join(bundleRoot, file.path))]));
    const archive = deterministicTarGz(entries);
    const name = `${providerId}-chunk-${chunk.chunkId}.tar.gz`;
    await atomicWrite(join(outputRoot, name), archive);
    chunks.push({archive: name, archiveSha256: sha256(archive), archiveSizeBytes: archive.byteLength, ...chunk});
  }
  const manifest = {schemaVersion: 1, providerId, providerVersion, bundleSha256, chunks};
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestPath = join(outputRoot, `${providerId}-chunks-${providerVersion}.json`);
  await atomicWrite(manifestPath, manifestBytes);
  return {manifestPath, manifestSha256: sha256(manifestBytes), manifestSizeBytes: manifestBytes.byteLength,
    chunkCount: chunks.length, bundleSha256};
}

/**
 * Release gate: every chunk archive matches its manifest, every chunk identity matches its
 * content, and the chunks together reproduce the built bundle exactly once.
 */
export async function verifyProviderChunks({bundleRoot, manifestPath, chunkRoot}) {
  const bundleSha256 = await providerBundleSha256(bundleRoot);
  let manifest;
  try {manifest = JSON.parse(await readFile(manifestPath, "utf8"));} catch {invalid();}
  if (!exactKeys(manifest, ["bundleSha256", "chunks", "providerId", "providerVersion", "schemaVersion"]) ||
    manifest.schemaVersion !== 1 || manifest.bundleSha256 !== bundleSha256 || !Array.isArray(manifest.chunks) ||
    !manifest.chunks.length) {invalid();}
  const provider = JSON.parse(await readFile(join(bundleRoot, "provider.json"), "utf8"));
  if (manifest.providerId !== provider.providerId || manifest.providerVersion !== provider.providerVersion) {invalid();}
  const seen = new Set(), ids = new Set();
  for (const chunk of manifest.chunks) {
    if (!exactKeys(chunk, ["archive", "archiveSha256", "archiveSizeBytes", "chunkId", "files", "unpackedSizeBytes"]) ||
      ids.has(chunk.chunkId) || chunk.archive !== `${manifest.providerId}-chunk-${chunk.chunkId}.tar.gz`) {invalid();}
    ids.add(chunk.chunkId);
    const expected = describe(chunk.files);
    if (expected.chunkId !== chunk.chunkId || expected.unpackedSizeBytes !== chunk.unpackedSizeBytes ||
      JSON.stringify(expected.files) !== JSON.stringify(chunk.files)) {invalid();}
    let archive;
    try {archive = await readFile(join(chunkRoot, chunk.archive));} catch {invalid();}
    if (archive.byteLength !== chunk.archiveSizeBytes || sha256(archive) !== chunk.archiveSha256) {invalid();}
    let entries;
    try {entries = readDeterministicTarGz(archive);} catch {invalid();}
    if (entries.length !== chunk.files.length) {invalid();}
    for (const [index, [path, contents]] of entries.entries()) {
      const file = chunk.files[index];
      if (path !== file.path || contents.byteLength !== file.sizeBytes || sha256(contents) !== file.sha256 || seen.has(path)) {
        invalid();
      }
      const built = await readFile(join(bundleRoot, path)).catch(() => invalid());
      if (Buffer.compare(built, contents) !== 0) {invalid();}
      seen.add(path);
    }
  }
  const bundlePaths = await listFiles(bundleRoot);
  if (bundlePaths.length !== seen.size || bundlePaths.some((path) => !seen.has(path))) {invalid();}
  return {chunkCount: manifest.chunks.length, fileCount: seen.size, bundleSha256};
}

async function listFiles(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), {withFileTypes: true})) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {result.push(...await listFiles(root, path));}
    else {result.push(path);}
  }
  return result;
}

async function atomicWrite(path, bytes) {
  const pending = `${path}.pending`;
  await rm(pending, {force: true});
  await writeFile(pending, bytes, {flag: "wx"});
  await rename(pending, path);
  const info = await lstat(path);
  if (!info.isFile() || info.size !== bytes.byteLength) {invalid();}
}

function compare(left, right) {return Buffer.from(left).compare(Buffer.from(right));}
function sha256(value) {return createHash("sha256").update(value).digest("hex");}
function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}
function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") &&
    !value.includes("\0") && value.split("/").every((part) => part && part !== "." && part !== "..");
}
function invalid() {throw new Error("PROVIDER_CHUNKS_INVALID");}
