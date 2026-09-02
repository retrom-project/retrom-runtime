import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {
  lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile,
} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofName = ".materialization.json";

export async function materializeEmulatorJsProviderInput(input) {
  validateInput(input);
  const expectedCatalogDigest = sha256(Buffer.from(canonicalJson(input.catalog)));
  if (await verifyExisting(input.outputRoot, expectedCatalogDigest, input.definition, false)) {
    return input.outputRoot;
  }
  await mkdir(dirname(input.outputRoot), {recursive: true});
  await mkdir(input.cacheRoot, {recursive: true});
  const staging = await mkdtemp(join(dirname(input.outputRoot), ".emulatorjs-provider-input-"));
  try {
    for (const release of input.catalog.releases) {
      const archivePath = join(input.cacheRoot, `${release.id}-${release.archive.name}`);
      await cachedDownload(archivePath, release.archive, input.fetchBytes);
      const destination = join(staging, release.id);
      await mkdir(destination, {recursive: true});
      await input.extractArchive(archivePath, destination, releaseSelections(input.definition, release));
    }
    for (const override of input.catalog.overrides) {
      const cachePath = join(input.cacheRoot, `override-${override.sha256}`);
      await cachedDownload(cachePath, override, input.fetchBytes);
      const destination = confined(staging, override.destination);
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, await readFile(cachePath));
    }
    await verifyCoreAssets(staging, input.definition);
    const files = await collectSelectedFiles(staging, input.catalog, input.definition);
    await writeFile(join(staging, proofName), `${JSON.stringify({
      catalogSha256: expectedCatalogDigest,
      files,
      schemaVersion: 1,
    }, null, 2)}\n`, {flag: "wx"});
    try {
      await rename(staging, input.outputRoot);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") {throw error;}
      try {
        if (await verifyExisting(input.outputRoot, expectedCatalogDigest, input.definition, true)) {return input.outputRoot;}
      } catch { /* A stale materialization is replaced below after the new staging tree is complete. */ }
      const stale = `${input.outputRoot}.stale-${process.pid}-${randomUUID()}`;
      await rename(input.outputRoot, stale);
      try {await rename(staging, input.outputRoot);}
      catch (replacementError) {await rename(stale, input.outputRoot); throw replacementError;}
      await rm(stale, {force: true, recursive: true});
    }
    return input.outputRoot;
  } finally {
    await rm(staging, {force: true, recursive: true});
  }
}

export async function checkEmulatorJsProviderInput(input) {
  validateInput(input);
  const digest = sha256(Buffer.from(canonicalJson(input.catalog)));
  if (!await verifyExisting(input.outputRoot, digest, input.definition, true)) {
    throw new Error("EMULATORJS_PROVIDER_INPUT_INVALID");
  }
  return input.outputRoot;
}

async function verifyExisting(outputRoot, catalogSha256, definition, strict) {
  try {
    const proof = JSON.parse(await readFile(join(outputRoot, proofName), "utf8"));
    if (!exactKeys(proof, ["catalogSha256", "files", "schemaVersion"]) || proof.schemaVersion !== 1 ||
      proof.catalogSha256 !== catalogSha256 || !Array.isArray(proof.files) || !proof.files.length) {
      throw new Error("invalid proof");
    }
    const actual = await collectRegularFiles(outputRoot, true);
    if (actual.size !== proof.files.length) {throw new Error("file set mismatch");}
    for (const entry of proof.files) {
      if (!exactKeys(entry, ["path", "sha256", "sizeBytes"]) || !safeRelative(entry.path) ||
        !/^[0-9a-f]{64}$/u.test(entry.sha256) || !positiveInteger(entry.sizeBytes)) {
        throw new Error("invalid file proof");
      }
      const contents = actual.get(entry.path);
      if (!contents || contents.byteLength !== entry.sizeBytes || sha256(contents) !== entry.sha256) {
        throw new Error("file proof mismatch");
      }
    }
    await verifyCoreAssets(outputRoot, definition);
    return true;
  } catch (error) {
    if (!strict && error?.code === "ENOENT") {return false;}
    if (!strict && error instanceof SyntaxError) {return false;}
    if (!strict && error instanceof Error && error.message === "invalid proof") {return false;}
    throw new Error("EMULATORJS_PROVIDER_INPUT_INVALID", {cause: error});
  }
}

async function cachedDownload(path, source, fetchBytes) {
  try {
    const contents = await readFile(path);
    if (contents.byteLength === source.sizeBytes && sha256(contents) === source.sha256) {return;}
    throw new Error("cached digest mismatch");
  } catch (error) {
    if (error?.code !== "ENOENT") {throw new Error("EMULATORJS_PROVIDER_DOWNLOAD_INVALID", {cause: error});}
  }
  const contents = await fetchBytes(source.url, source.sizeBytes);
  if (!(contents instanceof Uint8Array) || contents.byteLength !== source.sizeBytes ||
    sha256(contents) !== source.sha256) {
    throw new Error("EMULATORJS_PROVIDER_DOWNLOAD_INVALID");
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, {flag: "wx"});
  try {await rename(temporary, path);} finally {await rm(temporary, {force: true});}
}

function releaseSelections(definition, release) {
  const prefix = `assets/${release.id}/`;
  const assets = definition.targets.flatMap((target) => target.assetPaths ?? [])
    .filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
  return sortedUnique([...release.licenseRoots, ...assets]);
}

async function collectSelectedFiles(root, catalog, definition) {
  const files = await collectRegularFiles(root, false);
  const allowedAssets = new Set(definition.targets.flatMap((target) => target.assetPaths ?? [])
    .map((path) => path.replace(/^assets\//u, "")));
  const allowedLicenseRoots = catalog.releases.flatMap((release) => release.licenseRoots.map((path) =>
    `${release.id}/${path}`));
  for (const path of files.keys()) {
    if (!allowedAssets.has(path) && !allowedLicenseRoots.some((rootPath) =>
      path === rootPath || path.startsWith(`${rootPath}/`))) {
      throw new Error("EMULATORJS_PROVIDER_INPUT_UNEXPECTED_FILE");
    }
  }
  return [...files.entries()].map(([path, contents]) => ({
    path, sha256: sha256(contents), sizeBytes: contents.byteLength,
  })).sort((left, right) => compareUtf8(left.path, right.path));
}

async function collectRegularFiles(root, omitProof) {
  const result = new Map();
  async function visit(directory) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {throw new Error("unsafe input");}
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      const child = await lstat(path);
      if (child.isSymbolicLink()) {throw new Error("unsafe input");}
      if (child.isDirectory()) {await visit(path); continue;}
      if (!child.isFile()) {throw new Error("unsafe input");}
      const key = relative(root, path).replaceAll("\\", "/");
      if (omitProof && key === proofName) {continue;}
      if (!safeRelative(key) || result.has(key)) {throw new Error("unsafe input");}
      result.set(key, await readFile(path));
    }
  }
  await visit(root);
  return result;
}

async function verifyCoreAssets(root, definition) {
  for (const target of definition.targets) {
    const implementation = target.implementation;
    const path = implementation?.coreAssetPath?.replace(/^assets\//u, "");
    if (!path || path === implementation.coreAssetPath) {throw new Error("invalid core path");}
    const contents = await readFile(confined(root, path));
    if (contents.byteLength !== implementation.coreSizeBytes || sha256(contents) !== implementation.coreSha256) {
      throw new Error("core digest mismatch");
    }
  }
}

function validateInput(input) {
  if (!input || !isAbsolute(input.outputRoot) || !isAbsolute(input.cacheRoot) ||
    typeof input.fetchBytes !== "function" || typeof input.extractArchive !== "function" ||
    input.catalog?.schemaVersion !== 1 || !Array.isArray(input.catalog.releases) ||
    !input.catalog.releases.length || !Array.isArray(input.catalog.overrides) ||
    !Array.isArray(input.definition?.targets) || !input.definition.targets.length) {
    throw new Error("EMULATORJS_PROVIDER_INPUT_CONFIG_INVALID");
  }
}

async function fetchPinnedBytes(url, maximum) {
  if (!/^https:\/\//u.test(url) || !positiveInteger(maximum)) {
    throw new Error("EMULATORJS_PROVIDER_DOWNLOAD_INVALID");
  }
  const response = await fetch(url, {redirect: "follow", headers: {"User-Agent": "retrom-runtime-provider"}});
  if (!response.ok || !response.url.startsWith("https://") || !response.body) {
    throw new Error("EMULATORJS_PROVIDER_DOWNLOAD_INVALID");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maximum) {throw new Error("EMULATORJS_PROVIDER_DOWNLOAD_INVALID");}
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

async function extractWith7Zip(archive, destination, selections) {
  const executable = process.env.SEVEN_ZIP ?? "7z";
  const result = spawnSync(executable, ["x", "-y", `-o${destination}`, archive, ...selections], {
    encoding: "utf8", maxBuffer: 1024 * 1024 * 4,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error("EMULATORJS_PROVIDER_EXTRACTION_FAILED");
  }
}

function confined(root, path) {
  if (!safeRelative(path)) {throw new Error("unsafe path");}
  const destination = resolve(root, path);
  if (!destination.startsWith(`${resolve(root)}/`)) {throw new Error("unsafe path");}
  return destination;
}

function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    !value.includes("\\") && !value.includes("?") && !value.includes("#") && !value.includes("\0") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}
function positiveInteger(value) {return Number.isSafeInteger(value) && value > 0;}
function sha256(value) {return createHash("sha256").update(value).digest("hex");}
function compareUtf8(left, right) {return Buffer.from(left).compare(Buffer.from(right));}
function sortedUnique(values) {return [...new Set(values)].sort(compareUtf8);}
function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {return JSON.stringify(value);}
  if (typeof value === "number" && Number.isSafeInteger(value)) {return String(value);}
  if (Array.isArray(value)) {return `[${value.map(canonicalJson).join(",")}]`;}
  if (!value || typeof value !== "object") {throw new Error("invalid canonical JSON");}
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function currentInput() {
  const [{emulatorJsProviderDefinition}, {emulatorJsSourceCatalog}] = await Promise.all([
    import("../dist/providers/emulatorjs/catalog.js"),
    import("../dist/providers/emulatorjs/source-catalog.js"),
  ]);
  return {
    cacheRoot: join(scriptRoot, ".cache", "provider-downloads", "emulatorjs"),
    catalog: emulatorJsSourceCatalog,
    definition: emulatorJsProviderDefinition,
    extractArchive: extractWith7Zip,
    fetchBytes: fetchPinnedBytes,
    outputRoot: join(scriptRoot, ".cache", "provider-inputs", "emulatorjs-v1"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (process.argv.length !== 3 || command !== "prepare" && command !== "check") {
    throw new Error("EMULATORJS_PROVIDER_INPUT_COMMAND_INVALID");
  }
  const input = await currentInput();
  const result = command === "prepare"
    ? await materializeEmulatorJsProviderInput(input)
    : await checkEmulatorJsProviderInput(input);
  process.stdout.write(`${command}: ${result}\n`);
}
