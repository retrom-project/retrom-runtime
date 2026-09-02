import {createHash} from "node:crypto";
import {constants as zlibConstants, gzipSync} from "node:zlib";
import {lstat, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, parse, relative} from "node:path";

const integrityKeys = ["files", "schemaVersion"];
const fileKeys = ["mediaType", "path", "sha256", "sizeBytes"];

export async function buildProviderBundle(input) {
  await createEmptyDirectory(input.bundleRoot);
  await mkdir(input.archiveRoot, {recursive: true});
  const files = new Map([
    ["client.mjs", Buffer.from(input.clientModuleBytes)],
    ["provider.json", jsonBytes(input.manifest)],
    ["provenance.json", jsonBytes(input.provenance)],
  ]);
  await addSources(files, input.assetSources);
  await addSources(files, input.licenseSources);
  validateInputClosure(input.manifest, files);
  for (const [path, contents] of sortedEntries(files)) {await publish(input.bundleRoot, path, contents);}
  const integrity = {
    schemaVersion: 1,
    files: sortedEntries(files).map(([path, contents]) => ({
      path,
      sizeBytes: contents.byteLength,
      sha256: sha256(contents),
      mediaType: providerMediaType(path),
    })),
  };
  await publish(input.bundleRoot, "integrity.json", jsonBytes(integrity));
  await verifyProviderBundle(input.bundleRoot);
  const archiveName = `${input.manifest.providerId}-provider-${input.manifest.providerVersion}.tar.gz`;
  const archivePath = join(input.archiveRoot, archiveName);
  await assertAbsent(archivePath);
  const archive = deterministicGzip(await createTar(input.bundleRoot));
  await writeFile(archivePath, archive);
  return {
    archivePath,
    bundleRoot: input.bundleRoot,
    bundleSha256: sha256(archive),
    bundleSizeBytes: archive.byteLength,
    fileCount: files.size + 1,
    manifestSha256: sha256(files.get("provider.json")),
    unpackedSizeBytes: [...files.values()].reduce((total, bytes) => total + bytes.byteLength, 0) +
      jsonBytes(integrity).byteLength,
  };
}

export async function verifyProviderBundle(bundleRoot) {
  const rootInfo = await lstat(bundleRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {unsafe();}
  const actualFiles = await collectFiles(bundleRoot);
  const integrityBytes = actualFiles.get("integrity.json");
  if (!integrityBytes) {invalidIntegrity();}
  let integrity;
  try {integrity = JSON.parse(integrityBytes.toString("utf8"));} catch {invalidIntegrity();}
  if (!exactKeys(integrity, integrityKeys) || integrity.schemaVersion !== 1 || !Array.isArray(integrity.files)) {
    invalidIntegrity();
  }
  const expectedPaths = [];
  for (const entry of integrity.files) {
    if (!exactKeys(entry, fileKeys) || !safeRelative(entry.path) || expectedPaths.includes(entry.path) ||
      entry.mediaType !== providerMediaType(entry.path) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      invalidIntegrity();
    }
    const contents = actualFiles.get(entry.path);
    if (!contents || contents.byteLength !== entry.sizeBytes || sha256(contents) !== entry.sha256) {
      invalidIntegrity();
    }
    expectedPaths.push(entry.path);
  }
  if (!sorted(expectedPaths) || actualFiles.size !== expectedPaths.length + 1 ||
    [...actualFiles.keys()].some((path) => path !== "integrity.json" && !expectedPaths.includes(path))) {
    invalidIntegrity();
  }
  validateManifestClosure(actualFiles);
}

async function addSources(files, sources) {
  for (const [path, source] of sources) {
    if (!safeRelative(path) || files.has(path) || !isAbsolute(source)) {unsafe();}
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) {unsafe();}
    files.set(path, await readFile(source));
  }
}

function validateInputClosure(manifest, files) {
  if (manifest?.schemaVersion !== 1 || manifest.clientModulePath !== "client.mjs" ||
    !Array.isArray(manifest.targets) || !manifest.targets.length) {
    throw new Error("PROVIDER_MANIFEST_INVALID");
  }
  const assets = new Set(manifest.targets.flatMap((target) => target.assetPaths));
  if ([...assets].some((path) => !files.has(path)) ||
    [...files.keys()].some((path) => path.startsWith("assets/") && !assets.has(path))) {
    throw new Error("PROVIDER_MANIFEST_INVALID");
  }
}

function validateManifestClosure(files) {
  let manifest;
  try {manifest = JSON.parse(files.get("provider.json")?.toString("utf8") ?? "");}
  catch {throw new Error("PROVIDER_MANIFEST_INVALID");}
  validateInputClosure(manifest, files);
  if (!files.has(manifest.clientModulePath)) {throw new Error("PROVIDER_MANIFEST_INVALID");}
}

async function collectFiles(root) {
  const result = new Map();
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) {unsafe();}
      if (info.isDirectory()) {await visit(path); continue;}
      if (!info.isFile()) {unsafe();}
      const key = relative(root, path).replaceAll("\\", "/");
      if (!safeRelative(key) || result.has(key)) {unsafe();}
      result.set(key, await readFile(path));
    }
  }
  await visit(root);
  return result;
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

async function publish(root, path, contents) {
  const destination = join(root, path);
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, contents, {flag: "wx"});
}

async function createTar(root) {
  const files = await collectFiles(root);
  const chunks = [];
  for (const [path, contents] of sortedEntries(files)) {
    chunks.push(tarHeader(path, contents.byteLength), contents);
    const padding = (512 - contents.byteLength % 512) % 512;
    if (padding) {chunks.push(Buffer.alloc(padding));}
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  const {name, prefix} = splitTarPath(path);
  writeText(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeText(header, "ustar\0", 257, 6);
  writeText(header, "00", 263, 2);
  writeText(header, prefix, 345, 155);
  const checksum = header.reduce((total, value) => total + value, 0);
  writeText(header, `${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

function splitTarPath(path) {
  if (Buffer.byteLength(path) <= 100) {return {name: path, prefix: ""};}
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {return {name, prefix};}
  }
  unsafe();
}

function writeText(target, value, offset, length) {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > length) {unsafe();}
  bytes.copy(target, offset);
}

function writeOctal(target, value, offset, length) {
  writeText(target, `${value.toString(8).padStart(length - 1, "0")}\0`, offset, length);
}

function deterministicGzip(bytes) {
  const result = gzipSync(bytes, {level: zlibConstants.Z_BEST_COMPRESSION});
  result.fill(0, 4, 8);
  result[9] = 255;
  return result;
}

export function providerMediaType(path) {
  if (path.endsWith(".js") || path.endsWith(".mjs")) {return "text/javascript; charset=utf-8";}
  if (path.endsWith(".css")) {return "text/css; charset=utf-8";}
  if (path.endsWith(".json")) {return "application/json; charset=utf-8";}
  if (path.endsWith(".wasm")) {return "application/wasm";}
  if (path.endsWith(".zip")) {return "application/zip";}
  if (path.endsWith(".7z")) {return "application/x-7z-compressed";}
  if (path.endsWith(".png")) {return "image/png";}
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {return "image/jpeg";}
  if (path.endsWith(".gif")) {return "image/gif";}
  if (path.endsWith(".webp")) {return "image/webp";}
  if (path.endsWith(".svg")) {return "image/svg+xml";}
  if (path.endsWith(".ico")) {return "image/x-icon";}
  if (path.endsWith(".ogg")) {return "audio/ogg";}
  if (path.endsWith(".mp3")) {return "audio/mpeg";}
  if (path.endsWith(".wav")) {return "audio/wav";}
  if (path.endsWith(".woff")) {return "font/woff";}
  if (path.endsWith(".woff2")) {return "font/woff2";}
  if (/\.(?:md|rb|txt)$/iu.test(path) || /(?:^|\/)(?:LICENSE|COPYING)$/u.test(path)) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

function jsonBytes(value) {return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);}
function sha256(value) {return createHash("sha256").update(value).digest("hex");}
function sortedEntries(map) {return [...map.entries()].sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)));}
function sorted(values) {return values.every((value, index) => index === 0 || Buffer.compare(Buffer.from(values[index - 1]), Buffer.from(value)) < 0);}
function safeRelative(value) {return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.includes("?") && !value.includes("#") && !value.includes("\0") && value.split("/").every((part) => part && part !== "." && part !== "..");}
function exactKeys(value, expected) {return value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);}
async function assertAbsent(path) {try {await lstat(path); unsafe();} catch (error) {if (error?.code !== "ENOENT") {throw error;}}}
function unsafe() {throw new Error("PROVIDER_BUNDLE_UNSAFE");}
function invalidIntegrity() {throw new Error("PROVIDER_INTEGRITY_INVALID");}
