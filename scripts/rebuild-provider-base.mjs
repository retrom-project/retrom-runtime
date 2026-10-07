import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, mkdir, readFile, readdir, rename, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runtimeProviders} from "../dist/runtime/index.js";
import {projectProviderManifest} from "../dist/provider/manifest.js";
import {buildProviderClient} from "./provider-client-build.mjs";
import {buildProviderBundle} from "./provider-bundle.mjs";
import {buildContentAssets} from "./content-io/build-assets.mjs";
import {sourceTreeSha256} from "./provider-release.mjs";
import {execFileSync} from "node:child_process";
import {fingerprintProvider} from "./runtime-fingerprints.mjs";
import {readPFBProviderCoreFiles} from "./pfb-provider-cores.mjs";
import {buildRuntimeHostTool} from "./runtime-host-tool.mjs";
import {writeRuntimeInputs} from "./runtime-inputs.mjs";
import {assertONSCheckpointCore} from "./ons-core-abi.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capturedSource = sourceTreeSha256(root);
const [sourceRoot, outputRoot, coreInputRoot] = process.argv.slice(2).map(path => resolve(path));
if (!sourceRoot || !outputRoot || sourceRoot === outputRoot) {throw new Error("RUNTIME_BASE_INPUT_INVALID");}
await mkdir(outputRoot, {recursive: true});
if ((await readdir(outputRoot)).length !== 0) {throw new Error("RUNTIME_BASE_OUTPUT_NOT_EMPTY");}
const active = JSON.parse(await readFile(join(sourceRoot, "active.json"), "utf8"));
const sources = JSON.parse(await readFile(join(root, "provider-sources.json"), "utf8"));
const generatedRoot = join(outputRoot, "generated");
const generated = await buildContentAssets(generatedRoot);
const providers = [];
const pairedProviders = [];
const installationProofs = [];
for (const definition of runtimeProviders) {
  const original = active.providers.find(item => item.providerId === definition.providerId);
  if (!original || !/^[a-f0-9]{64}$/u.test(original.bundleSha256) ||
    original.installationPath !== `${original.providerId}/${original.bundleSha256}`) {throw new Error("RUNTIME_BASE_INVALID");}
  const installation = join(sourceRoot, "installed", original.installationPath);
  const integrity = JSON.parse(await readFile(join(installation, "integrity.json"), "utf8"));
  const index = {};
  for (const file of integrity.files) {
    if (!safePath(file.path)) {throw new Error("RUNTIME_BASE_INVALID");}
    const path = join(installation, file.path), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.sizeBytes || await fileHash(path) !== file.sha256) {
      throw new Error(`RUNTIME_BASE_INTEGRITY_FAILED:${file.path}`);
    }
    index[file.path] = {sha256: file.sha256, sizeBytes: file.sizeBytes};
  }
  const manifest = {...projectProviderManifest(definition), providerVersion: original.providerVersion};
  const assets = new Map();
  const declared = new Set(manifest.targets.flatMap(target => target.assetPaths));
  for (const path of declared) {
    if (!index[path]) {throw new Error(`RUNTIME_BASE_ASSET_MISSING:${path}`);}
    assets.set(path, join(installation, path));
  }
  for (const asset of generated.files) {
    if (declared.has(asset.path)) {assets.set(asset.path, join(generatedRoot, asset.path.split("/").at(-1)));}
  }
  if (definition.providerId === "retrom-runtime") {
    for (const local of sources.localAssets) {assets.set(`assets/${local.output.replace(/^runtime\//u, "")}`, join(root, local.source));}
  }
  for (const [path, source] of assets) {
    const info = await lstat(source); index[path] = {sha256: await fileHash(source), sizeBytes: info.size};
  }
  const coreInputs = [];
  const coreLicenses = new Map();
  if (coreInputRoot && definition.providerId === "retrom-runtime") {
    const selection = JSON.parse(await readFile(join(coreInputRoot, "core-inputs.json"), "utf8"));
    const coreFiles = await readPFBProviderCoreFiles(coreInputRoot, definition.providerId, join(outputRoot, "core-staging"), index);
    for (const file of coreFiles) {
      const source = join(outputRoot, "core-overrides", file.path);
      await mkdir(dirname(source), {recursive: true}); await writeFile(source, file.contents);
      if (file.path.startsWith("licenses/")) {coreLicenses.set(file.path, source);}
      else {
        if (!declared.has(file.path)) {throw new Error("RUNTIME_CORE_ASSET_UNDECLARED");}
        assets.set(file.path, source); index[file.path] = {sha256: await fileHash(source), sizeBytes: file.contents.length};
      }
    }
    for (const core of selection.cores) {
      const descriptorPath = join(core.directory, "retrom-core-candidate.json");
      const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
      coreInputs.push({id: core.id, commit: descriptor.commit, branch: descriptor.branch,
        sourceTreeSha256: descriptor.sourceTreeSha256, descriptorSha256: await fileHash(descriptorPath), files: descriptor.files});
    }
  }
  if (definition.providerId === "retrom-runtime") {
    assertONSCheckpointCore(await readFile(assets.get("assets/ons/onsyuri.js")),
      await readFile(assets.get("assets/ons/onsyuri.wasm")));
  }
  const fingerprints = await fingerprintProvider(definition, index);
  const temporary = join(outputRoot, `${definition.providerId}-input`);
  await mkdir(temporary);
  const client = join(temporary, "client.mjs");
  await buildProviderClient({providerVersion: manifest.providerVersion, assetIndex: index,
    entryPoint: join(root, "src/providers", definition.providerId, "module.ts"), outfile: client});
  const identityPath = join(temporary, "runtime-fingerprints.json");
  await writeFile(identityPath, JSON.stringify({schemaVersion: 1, providerId: definition.providerId, targets: fingerprints}));
  const licenses = new Map(integrity.files.filter(file => file.path.startsWith("licenses/")).map(file => [file.path, join(installation, file.path)]));
  licenses.set("runtime-fingerprints.json", identityPath);
  for (const [path, source] of coreLicenses) {licenses.set(path, source);}
  const result = await buildProviderBundle({bundleRoot: join(outputRoot, "bundles", definition.providerId),
    archiveRoot: join(outputRoot, "archives"), manifest, assetSources: assets, licenseSources: licenses,
    clientModuleBytes: await readFile(client), provenance: {schemaVersion: 1, sourceBundleSha256: original.bundleSha256,
      source: "verified-provider-assets", runtimeCommit: execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim(),
      runtimeSourceTreeSha256: capturedSource, coreInputs}});
  const installationPath = `${definition.providerId}/${result.bundleSha256}`;
  await mkdir(join(outputRoot, "installed", definition.providerId), {recursive: true});
  await rename(result.bundleRoot, join(outputRoot, "installed", installationPath));
  pairedProviders.push({...result, bundleRoot: join(outputRoot, "installed", installationPath)});
  const installationProof = {schemaVersion: 1, providerId: definition.providerId, providerVersion: manifest.providerVersion,
    bundleSha256: result.bundleSha256, manifestSha256: result.manifestSha256, fileCount: result.fileCount, unpackedSizeBytes: result.unpackedSizeBytes};
  installationProofs.push({path: join(outputRoot, "installed", installationPath, ".installation.json"), value: installationProof});
  providers.push({providerId: definition.providerId, providerVersion: manifest.providerVersion, providerApiVersion: 1,
    installationPath, bundleSha256: result.bundleSha256, bundleSizeBytes: result.bundleSizeBytes,
    clientModulePath: "client.mjs", moduleSha256: await fileHash(client), manifestSha256: result.manifestSha256,
    fileCount: result.fileCount, unpackedSizeBytes: result.unpackedSizeBytes,
    targets: manifest.targets.map(target => ({id: target.id, checkpoint: target.checkpoint}))});
  process.stdout.write(`${definition.providerId}: ${manifest.targets.length} targets ${result.bundleSha256}\n`);
}
await writeFile(join(outputRoot, "active.json"), JSON.stringify({schemaVersion: 1, source: "candidate", release: null, sourceTreeSha256: capturedSource, providers}));
const tool = await buildRuntimeHostTool({repositoryRoot: root, outputRoot: join(outputRoot, "archives"),
  version: providers[0].providerVersion, sourceTreeSha256: capturedSource});
if (sourceTreeSha256(root) !== capturedSource) {throw new Error("RUNTIME_SOURCE_CHANGED");}
await writeRuntimeInputs({outputRoot: join(outputRoot, "archives"), sourceTreeSha256: capturedSource,
  tool, providers: pairedProviders});
for (const proof of installationProofs) {await writeFile(proof.path, JSON.stringify(proof.value));}
async function fileHash(path) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) {hash.update(chunk);} return hash.digest("hex");
}
function safePath(path) {return typeof path === "string" && !path.startsWith("/") && !path.includes("\\") &&
  path.split("/").every(part => part !== "" && part !== "." && part !== "..");}
