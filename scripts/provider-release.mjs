import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {lstatSync, readFileSync, readlinkSync} from "node:fs";
import {readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {verifyProviderBundle} from "./provider-bundle.mjs";
import {
  buildEmulatorJsProviderBundle,
  buildRetromRuntimeProviderBundle,
} from "./provider-release-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildMetadataName = "provider-build.json";
const releaseMetadataName = "provider-release.json";
const repository = "https://github.com/retrom-project/retrom-runtime";

export async function buildCurrentProviderBuild(input = {}) {
  const stageRoot = input.stageRoot ?? join(root, "release", "stage");
  const outputRoot = input.outputRoot ?? join(root, "release", "providers");
  const emulatorJsSourceRoot = input.emulatorJsSourceRoot ?? process.env.RETROM_EMULATORJS_PROVIDER_INPUT_ROOT ??
    join(root, ".cache", "provider-inputs", "emulatorjs-v1");
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
    definition: retromRuntimeProviderDefinition,
    entryPoint: join(root, "src", "providers", "retrom-runtime", "module.ts"),
    manifest: retromManifest,
    outputRoot: join(outputRoot, "retrom-runtime"),
    stageRoot,
  });
  const emulatorjs = await buildEmulatorJsProviderBundle({
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
  const metadata = createProviderBuildMetadata(providers, input.sourceTreeSha256 ?? sourceTreeSha256());
  await writeFile(join(outputRoot, buildMetadataName), `${JSON.stringify(metadata, null, 2)}\n`);
  return {archivePath: retrom.archivePath, metadata, outputRoot, providers: {emulatorjs, retromRuntime: retrom}};
}

export async function checkCurrentProviderBuild(input = {}) {
  const outputRoot = input.outputRoot ?? join(root, "release", "providers");
  const metadata = JSON.parse(await readFile(join(outputRoot, buildMetadataName), "utf8"));
  const {validateProviderManifest} = await import("../dist/provider/contract.js");
  if (!exactKeys(metadata, ["providers", "schemaVersion", "sourceTreeSha256"]) || metadata.schemaVersion !== 1 ||
    !/^[0-9a-f]{64}$/u.test(metadata.sourceTreeSha256) ||
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

export function createProviderBuildMetadata(providers, sourceTreeSha256) {
  if (!Array.isArray(providers) || providers.length !== 2 || !/^[0-9a-f]{64}$/u.test(sourceTreeSha256)) {invalid();}
  for (const provider of providers) {validateMetadata(provider);}
  const sortedProviders = [...providers].sort((left, right) => Buffer.from(left.providerId).compare(Buffer.from(right.providerId)));
  if (sortedProviders.map((provider) => provider.providerId).join("\0") !== `emulatorjs${"\0"}retrom-runtime`) {invalid();}
  return {providers: sortedProviders, schemaVersion: 1, sourceTreeSha256};
}

export function pinProviderReleaseMetadata(build, release, packageVersion) {
  if (!exactKeys(build, ["providers", "schemaVersion", "sourceTreeSha256"]) || build.schemaVersion !== 1 ||
    !/^[0-9a-f]{64}$/u.test(build.sourceTreeSha256) || !validRelease(release) ||
    release.tag !== `v${packageVersion}` || !build.providers.some((provider) =>
      provider.providerId === "retrom-runtime" && provider.providerVersion === packageVersion)) {invalid();}
  const verified = createProviderBuildMetadata(build.providers, build.sourceTreeSha256);
  return {providers: verified.providers, release: {...release}, schemaVersion: 1};
}

export async function pinCurrentProviderRelease(input = {}) {
  const outputRoot = input.outputRoot ?? join(root, "release", "providers");
  const build = (await checkCurrentProviderBuild({outputRoot})).metadata;
  const packageVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8").catch(invalid)).version;
  const release = input.release ?? {commit: releaseCommit(), repository, tag: `v${packageVersion}`};
  const metadata = pinProviderReleaseMetadata(build, release, packageVersion);
  await writeFile(join(outputRoot, releaseMetadataName), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
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

export function sourceTreeSha256(repositoryRoot = root) {
  const paths = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot, encoding: "buffer",
  });
  const stages = spawnSync("git", ["ls-files", "--stage", "-z"], {cwd: repositoryRoot, encoding: "buffer"});
  if (paths.status !== 0 || stages.status !== 0) {throw new Error("PROVIDER_SOURCE_TREE_UNAVAILABLE");}
  const modes = new Map(stages.stdout.toString("utf8").split("\0").filter(Boolean).map((line) => {
    const [prefix, path] = line.split("\t");
    return [path, prefix.split(" ", 1)[0]];
  }));
  const records = paths.stdout.toString("utf8").split("\0").filter(Boolean)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))).flatMap((path) => {
      let info;
      try {info = lstatSync(join(repositoryRoot, path));}
      catch (error) {
        if (error?.code === "ENOENT") {return [];}
        throw error;
      }
      const mode = info.isSymbolicLink() ? "120000" : modes.get(path) ?? ((info.mode & 0o100) ? "100755" : "100644");
      const contents = mode === "120000"
        ? Buffer.from(readlinkSync(join(repositoryRoot, path)))
        : readFileSync(join(repositoryRoot, path));
      return [{mode, path, sha256: sha256(contents)}];
    });
  return sha256(Buffer.from(canonicalJson(records)));
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
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {return JSON.stringify(value);}
  if (typeof value === "number" && Number.isSafeInteger(value)) {return String(value);}
  if (Array.isArray(value)) {return `[${value.map(canonicalJson).join(",")}]`;}
  if (!value || typeof value !== "object") {invalid();}
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function invalid() {throw new Error("PROVIDER_RELEASE_INVALID");}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (process.argv.length !== 3 || command !== "build" && command !== "check" && command !== "pin-release") {invalid();}
  if (command === "pin-release") {await pinCurrentProviderRelease(); process.stdout.write("pin-release: provider-release.json\n"); process.exit(0);}
  const result = command === "build" ? await buildCurrentProviderBuild() : await checkCurrentProviderBuild();
  for (const provider of command === "build"
    ? Object.values(result.providers)
    : result.providers) {
    process.stdout.write(`${command}: ${relative(root, provider.archivePath)}\n`);
  }
}
