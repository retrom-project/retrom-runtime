import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {verifyProviderBundle} from "./provider-bundle.mjs";
import {
  buildEmulatorJsProviderBundle,
  buildRetromRuntimeProviderBundle,
} from "./provider-release-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadataName = "provider-release.json";
const repository = "https://github.com/retrom-project/retrom-runtime";

export async function buildCurrentProviderRelease(input = {}) {
  const stageRoot = input.stageRoot ?? join(root, "release", "stage");
  const outputRoot = input.outputRoot ?? join(root, "release", "providers");
  const emulatorJsSourceRoot = input.emulatorJsSourceRoot ?? process.env.RETROM_EMULATORJS_PROVIDER_INPUT_ROOT ??
    join(root, ".cache", "provider-inputs", "emulatorjs-v1");
  const commit = input.commit ?? releaseCommit();
  const tag = input.tag ?? `v${JSON.parse(await readFile(join(root, "package.json"), "utf8")).version}`;
  const [{retromRuntimeProviderDefinition}, {emulatorJsProviderDefinition}, {emulatorJsSourceCatalog},
    {projectProviderManifest}, {validateProviderManifest}] = await Promise.all([
    import("../dist/providers/retrom-runtime/catalog.js"),
    import("../dist/providers/emulatorjs/catalog.js"),
    import("../dist/providers/emulatorjs/source-catalog.js"),
    import("../dist/provider/manifest.js"),
    import("../dist/provider/contract.js"),
  ]);
  await rm(outputRoot, {force: true, recursive: true});
  const retromManifest = projectProviderManifest(retromRuntimeProviderDefinition);
  const emulatorManifest = projectProviderManifest(emulatorJsProviderDefinition);
  validateProviderManifest(retromManifest);
  validateProviderManifest(emulatorManifest);
  const retrom = await buildRetromRuntimeProviderBundle({
    commit,
    definition: retromRuntimeProviderDefinition,
    entryPoint: join(root, "src", "providers", "retrom-runtime", "module.ts"),
    manifest: retromManifest,
    outputRoot: join(outputRoot, "retrom-runtime"),
    stageRoot,
  });
  const emulatorjs = await buildEmulatorJsProviderBundle({
    commit,
    definition: emulatorJsProviderDefinition,
    entryPoint: join(root, "src", "providers", "emulatorjs", "module.ts"),
    manifest: emulatorManifest,
    outputRoot: join(outputRoot, "emulatorjs"),
    sourceCatalog: emulatorJsSourceCatalog,
    sourceRoot: resolve(emulatorJsSourceRoot),
  });
  const providers = [releaseMetadata(outputRoot, retromManifest, retrom),
    releaseMetadata(outputRoot, emulatorManifest, emulatorjs)]
    .sort((left, right) => Buffer.from(left.providerId).compare(Buffer.from(right.providerId)));
  const metadata = {providers, release: {commit, repository, tag}, schemaVersion: 1};
  await writeFile(join(outputRoot, metadataName), `${JSON.stringify(metadata, null, 2)}\n`);
  return {archivePath: retrom.archivePath, metadata, outputRoot, providers: {emulatorjs, retromRuntime: retrom}};
}

export async function checkCurrentProviderRelease(input = {}) {
  const outputRoot = input.outputRoot ?? join(root, "release", "providers");
  const metadata = JSON.parse(await readFile(join(outputRoot, metadataName), "utf8"));
  const {validateProviderManifest} = await import("../dist/provider/contract.js");
  if (!exactKeys(metadata, ["providers", "release", "schemaVersion"]) || metadata.schemaVersion !== 1 ||
    !validRelease(metadata.release) ||
    !Array.isArray(metadata.providers) || metadata.providers.length !== 2 ||
    metadata.providers.map((provider) => provider.providerId).join("\0") !== `emulatorjs${"\0"}retrom-runtime`) {
    invalid();
  }
  const results = [];
  for (const provider of metadata.providers) {
    validateMetadata(provider);
    const bundleRoot = confined(outputRoot, provider.bundleDirectory);
    const archivePath = confined(outputRoot, provider.archive);
    await verifyProviderBundle(bundleRoot);
    const archive = await readFile(archivePath);
    if (archive.byteLength !== provider.bundleSizeBytes || sha256(archive) !== provider.bundleSha256) {invalid();}
    const manifest = JSON.parse(await readFile(join(bundleRoot, "provider.json"), "utf8"));
    validateProviderManifest(manifest);
    const manifestBytes = await readFile(join(bundleRoot, "provider.json"));
    if (manifest.providerId !== provider.providerId || manifest.providerVersion !== provider.providerVersion ||
      sha256(manifestBytes) !== provider.manifestSha256) {invalid();}
    results.push({archivePath, bundleRoot, metadata: provider});
  }
  return {archivePath: results.find((result) => result.metadata.providerId === "retrom-runtime")?.archivePath,
    metadata, outputRoot, providers: results};
}

function validRelease(value) {
  return exactKeys(value, ["commit", "repository", "tag"]) && value.repository === repository &&
    /^[0-9a-f]{40}$/u.test(value.commit) && /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(value.tag);
}

function releaseMetadata(outputRoot, manifest, result) {
  return {
    archive: relative(outputRoot, result.archivePath).replaceAll("\\", "/"),
    bundleDirectory: relative(outputRoot, result.bundleRoot).replaceAll("\\", "/"),
    bundleSha256: result.bundleSha256,
    bundleSizeBytes: result.bundleSizeBytes,
    fileCount: result.fileCount,
    manifestSha256: result.manifestSha256,
    providerId: manifest.providerId,
    providerVersion: manifest.providerVersion,
    unpackedSizeBytes: result.unpackedSizeBytes,
  };
}

function validateMetadata(value) {
  if (!exactKeys(value, [
    "archive", "bundleDirectory", "bundleSha256", "bundleSizeBytes", "fileCount", "manifestSha256",
    "providerId", "providerVersion", "unpackedSizeBytes",
  ]) || !["emulatorjs", "retrom-runtime"].includes(value.providerId) ||
    !safeRelative(value.archive) || !safeRelative(value.bundleDirectory) ||
    !/^[0-9a-f]{64}$/u.test(value.bundleSha256) || !/^[0-9a-f]{64}$/u.test(value.manifestSha256) ||
    !positiveInteger(value.bundleSizeBytes) || !positiveInteger(value.fileCount) ||
    !positiveInteger(value.unpackedSizeBytes)) {invalid();}
}

function confined(outputRoot, path) {
  if (!safeRelative(path)) {invalid();}
  const result = resolve(outputRoot, path);
  if (!result.startsWith(`${resolve(outputRoot)}/`)) {invalid();}
  return result;
}

function releaseCommit() {
  const configured = process.env.GITHUB_SHA ?? process.env.RPG_RUNTIME_RELEASE_COMMIT;
  if (configured && /^[0-9a-f]{40}$/u.test(configured)) {return configured;}
  const result = spawnSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"});
  const value = result.stdout?.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/u.test(value)) {throw new Error("RELEASE_COMMIT_UNAVAILABLE");}
  return value;
}

function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") &&
    !value.includes("?") && !value.includes("#") && value.split("/").every((part) => part && part !== "." && part !== "..");
}
function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}
function positiveInteger(value) {return Number.isSafeInteger(value) && value > 0;}
function sha256(value) {return createHash("sha256").update(value).digest("hex");}
function invalid() {throw new Error("PROVIDER_RELEASE_INVALID");}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (process.argv.length !== 3 || command !== "build" && command !== "check") {invalid();}
  const result = command === "build" ? await buildCurrentProviderRelease() : await checkCurrentProviderRelease();
  for (const provider of command === "build"
    ? Object.values(result.providers)
    : result.providers) {
    process.stdout.write(`${command}: ${relative(root, provider.archivePath)}\n`);
  }
}
