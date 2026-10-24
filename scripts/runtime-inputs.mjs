import {createHash, randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {copyFile, lstat, readFile, rename, rm, writeFile} from "node:fs/promises";
import {basename, join, resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {verifyProviderBundle} from "./provider-bundle.mjs";
import {chunkProviderBundle, verifyProviderChunks} from "./provider-chunks.mjs";
import {versionFromTag} from "./release-version.mjs";

const repository = "https://github.com/retrom-project/retrom-runtime";
const digest = /^[a-f0-9]{64}$/u;
const execute = promisify(execFile);

/** Rebuilt bundles need their own transport closure before a paired pin can be written. */
export async function writeRebuiltRuntimeInputs(input) {
  const providers = [];
  for (const provider of input.providers) {
    const manifest = JSON.parse(await readFile(join(provider.bundleRoot, "provider.json"), "utf8"));
    const chunkRoot = join(input.outputRoot, manifest.providerId, "chunks");
    const chunks = await chunkProviderBundle({bundleRoot: provider.bundleRoot, providerId: manifest.providerId,
      providerVersion: manifest.providerVersion, outputRoot: chunkRoot});
    providers.push({...provider, chunkRoot, chunks});
  }
  return writeRuntimeInputs({...input, providers});
}

/** One paired input descriptor for explicit local candidates and tagged releases. */
export async function writeRuntimeInputs({outputRoot, sourceTreeSha256, release = null, tool, providers}) {
  if (!digest.test(sourceTreeSha256) || !Array.isArray(providers) || providers.length !== 2) {invalid();}
  validateRelease(release);
  const toolRecord = {archive: basename(tool.archivePath), sizeBytes: tool.sizeBytes, sha256: tool.sha256};
  if (!/^retrom-runtime-host-tool-[0-9][0-9A-Za-z.-]*\.tar\.gz$/u.test(toolRecord.archive)) {invalid();}
  await verifyArchive(tool.archivePath, tool.sizeBytes, tool.sha256);
  const {stdout} = await execute("tar", ["-xOf", tool.archivePath,
    `${toolRecord.archive.slice(0, -7)}/host-tool.json`], {encoding: "utf8", maxBuffer: 65536, timeout: 10000});
  const hostTool = JSON.parse(stdout);
  if (hostTool.schemaVersion !== 1 || hostTool.sourceTreeSha256 !== sourceTreeSha256) {invalid();}
  const records = [];
  const transport = [tool];
  for (const input of providers) {
    await verifyProviderBundle(input.bundleRoot);
    const manifestPath = input.chunks.manifestPath;
    await verifyArchive(manifestPath, input.chunks.manifestSizeBytes, input.chunks.manifestSha256);
    const verified = await verifyProviderChunks({bundleRoot: input.bundleRoot, manifestPath, chunkRoot: input.chunkRoot});
    if (verified.bundleSha256 !== input.bundleSha256) {invalid();}
    const manifest = JSON.parse(await readFile(join(input.bundleRoot, "provider.json"), "utf8"));
    const integrity = JSON.parse(await readFile(join(input.bundleRoot, "integrity.json"), "utf8"));
    const provenance = JSON.parse(await readFile(join(input.bundleRoot, "provenance.json"), "utf8"));
    if (provenance.schemaVersion !== 1 || provenance.runtimeSourceTreeSha256 !== sourceTreeSha256) {invalid();}
    const client = integrity.files.find(file => file.path === manifest.clientModulePath);
    if (!client || !digest.test(client.sha256) || manifest.clientModulePath !== "client.mjs") {invalid();}
    const id = manifest.providerId, version = manifest.providerVersion;
    if (!["emulatorjs", "retrom-runtime"].includes(id) || records.some(record => record.providerId === id) ||
      basename(manifestPath) !== `${id}-chunks-${version}.json` || hostTool.version !== version) {invalid();}
    if (release && `v${version}` !== release.tag) {invalid();}
    records.push({bundleSha256: input.bundleSha256,
      chunkManifest: {asset: basename(manifestPath), sha256: input.chunks.manifestSha256, sizeBytes: input.chunks.manifestSizeBytes},
      fileCount: input.fileCount, manifestSha256: input.manifestSha256, moduleSha256: client.sha256, providerId: id,
      providerVersion: version, unpackedSizeBytes: input.unpackedSizeBytes});
    // Chunks and their manifest are published flat next to runtime-inputs.json as release assets.
    const chunkManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    transport.push({archivePath: manifestPath, sizeBytes: input.chunks.manifestSizeBytes, sha256: input.chunks.manifestSha256},
      ...chunkManifest.chunks.map(chunk => ({archivePath: join(input.chunkRoot, chunk.archive),
        sizeBytes: chunk.archiveSizeBytes, sha256: chunk.archiveSha256})));
  }
  records.sort((left, right) => left.providerId.localeCompare(right.providerId));
  for (const archive of transport) {await publishTransportArchive(outputRoot, archive);}
  const descriptor = {schemaVersion: 1, repository, sourceTreeSha256, release, tool: toolRecord, providers: records};
  await writeFile(join(outputRoot, "runtime-inputs.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
  return descriptor;
}

function validateRelease(release) {
  if (release === null) {return;}
  if (!release || Object.keys(release).sort().join() !== "commit,repository,tag" || release.repository !== repository ||
    !/^[a-f0-9]{40}$/u.test(release.commit)) {invalid();}
  try {versionFromTag(release.tag);} catch {invalid();}
}
async function publishTransportArchive(outputRoot, archive) {
  const target = join(outputRoot, basename(archive.archivePath));
  if (resolve(target) === resolve(archive.archivePath)) {return;}
  const pending = join(outputRoot, `.runtime-input-${randomUUID()}`);
  try {
    await copyFile(archive.archivePath, pending);
    await verifyArchive(pending, archive.sizeBytes, archive.sha256);
    await rename(pending, target);
  } finally {await rm(pending, {force: true});}
}
async function verifyArchive(path, size, expected) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !Number.isSafeInteger(size) || size < 1 ||
    info.size !== size || !digest.test(expected)) {invalid();}
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {hash.update(chunk);}
  if (hash.digest("hex") !== expected) {invalid();}
}
function invalid() {throw new Error("RUNTIME_INPUTS_INVALID");}
