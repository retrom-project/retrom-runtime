import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, cp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {fileURLToPath} from "node:url";
import { parseDevReleaseOverrides } from "./dev-release-overrides.mjs";
import { loadProviderSources, sha256 } from "./provider-sources.mjs";
import { buildCurrentProviderBuild, pinCurrentProviderRelease } from "./provider-release.mjs";

const root = new URL("../", import.meta.url);
const requestedBuildMode = process.env.RETROM_PROVIDER_BUILD_MODE ?? "candidate";
const candidateBuild = process.env.RETROM_PFB_CANDIDATE_BUILD === "1" || requestedBuildMode === "candidate";
const formalBuild = requestedBuildMode === "release";
const providerOnly = process.env.RETROM_PROVIDER_BUILD_ONLY === "1";
if (candidateBuild === formalBuild) {throw new Error("PROVIDER_BUILD_MODE_REQUIRED");}
await rejectRetiredCandidateDeclaration(root);
const sources = await loadProviderSources(root);
const devReleaseOverrides = parseDevReleaseOverrides(
  process.env.RETROM_RUNTIME_DEV_RELEASE_OVERRIDES,
  sources.upstreamReleases,
);
const commit = releaseCommit();
const stage = new URL("../release/stage/", import.meta.url);
const output = new URL("../release/", import.meta.url);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(new URL("../dist", import.meta.url), new URL("library", stage), { recursive: true });
for (const document of ["CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  await publish(await readFile(new URL(`../${document}`, import.meta.url)), new URL(document, stage));
}
for (const asset of sources.localAssets) {
  await publish(await readFile(new URL(asset.source, root)), new URL(asset.output, stage));
}
for (const release of sources.upstreamReleases) {
  const devRoot = devReleaseOverrides.get(release.id);
  if (!devRoot) {
    const metadata = await download(release.metadataUrl, 65536);
    validateUpstreamMetadata(release, JSON.parse(new TextDecoder().decode(metadata)));
  }
  for (const asset of release.assets) {
    const contents = devRoot
      ? await readDevAsset(join(devRoot, asset.filename), asset.maxSizeBytes)
      : await download(asset.url, asset.maxSizeBytes);
    await publish(contents, new URL(asset.output, stage));
  }
}
const records = await collectRecords(sources, stage);
const metadata = {
  schemaVersion: 1,
  repository: "https://github.com/retrom-project/retrom-runtime",
  tag: `v${sources.packageVersion}`,
  commit,
  version: sources.packageVersion,
  publicApiVersion: sources.publicApiVersion,
  files: records,
};
await writeFile(new URL("retrom-runtime-release.json", output), `${JSON.stringify(metadata, null, 2)}\n`);
const provider = await buildCurrentProviderBuild({
  stageRoot: fileURLToPath(stage),
});
await verifyBuiltProvider(provider);
if (formalBuild) {
  assertFormalReleaseEnvironment(commit, sources.packageVersion);
  await pinCurrentProviderRelease({release: {
    commit, repository: "https://github.com/retrom-project/retrom-runtime", tag: `v${sources.packageVersion}`,
  }});
}

function assertFormalReleaseEnvironment(commit, packageVersion) {
  if (process.env.GITHUB_REF_TYPE !== "tag" || process.env.GITHUB_REF_NAME !== `v${packageVersion}` ||
    process.env.GITHUB_SHA !== commit) {throw new Error("PROVIDER_FORMAL_RELEASE_IDENTITY_INVALID");}
}
if (!providerOnly) {
  const archive = `retrom-runtime-${sources.packageVersion}.tar.gz`;
  const tar = spawnSync("tar", ["--sort=name", "--mtime=UTC 2020-01-01", "--owner=0", "--group=0", "--numeric-owner", "-czf", archive, "-C", "stage", "."], {
    cwd: new URL("../release", import.meta.url),
    stdio: "inherit",
  });
  if (tar.status !== 0) {throw new Error("RELEASE_ARCHIVE_FAILED");}
  const npmPackage = createNpmPackage(sources.packageVersion);
  console.log(`release: ${archive}, ${npmPackage}`);
}

async function verifyBuiltProvider(provider) {
  const retrom = provider.metadata.providers.find((entry) => entry.providerId === "retrom-runtime");
  const emulatorjs = provider.metadata.providers.find((entry) => entry.providerId === "emulatorjs");
  if (retrom?.providerVersion !== sources.packageVersion || emulatorjs?.providerVersion !== "1.0.0") {
    throw new Error("PROVIDER_RELEASE_INVALID");
  }
}

function releaseCommit() {
  const configured = process.env.GITHUB_SHA ?? process.env.RPG_RUNTIME_RELEASE_COMMIT;
  if (configured && /^[0-9a-f]{40}$/u.test(configured)) {return configured;}
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const value = result.stdout?.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/u.test(value)) {throw new Error("RELEASE_COMMIT_UNAVAILABLE");}
  return value;
}

function createNpmPackage(version) {
  const result = spawnSync("npm", ["pack", "--pack-destination", "release"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error("NPM_PACKAGE_FAILED");
  }
  const generated = result.stdout.trim().split(/\r?\n/u).at(-1);
  const expected = `xxxsen-retrom-runtime-${version}.tgz`;
  if (generated !== expected) {throw new Error("NPM_PACKAGE_NAME_INVALID");}
  return expected;
}

async function download(url, maximum) {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "retrom-runtime-release" } });
  if (!response.ok || !response.url.startsWith("https://")) {throw new Error(`DOWNLOAD_FAILED:${url}`);}
  const contents = new Uint8Array(await response.arrayBuffer());
  if (!contents.length || contents.length > maximum) {throw new Error(`DOWNLOAD_SIZE_INVALID:${url}`);}
  return contents;
}

async function readDevAsset(path, maximum) {
  const contents = await readFile(path);
  if (!contents.length || contents.length > maximum) {throw new Error(`DEV_ASSET_SIZE_INVALID:${path}`);}
  return contents;
}

function validateUpstreamMetadata(release, metadata) {
  if (metadata?.repository !== release.repository || metadata.tag !== release.tag ||
    metadata.commit !== release.commit || metadata.adapterAbi !== release.adapterAbi) {
    throw new Error(`UPSTREAM_METADATA_INVALID:${release.id}`);
  }
}

async function publish(contents, target) {
  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, contents);
}

async function collectRecords(value, directory) {
  const paths = ["CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "library/index.js", "library/index.d.ts",
    ...value.localAssets.map((asset) => asset.output),
    ...value.upstreamReleases.flatMap((release) => release.assets.map((asset) => asset.output))].sort();
  return Promise.all(paths.map(async (path) => {
    const contents = await readFile(new URL(path, directory));
    return { path, filename: basename(path), sizeBytes: contents.length, sha256: sha256(contents) };
  }));
}

async function rejectRetiredCandidateDeclaration(base) {
  try {
    await access(new URL("candidate/runtime-candidate.json", base));
  } catch (error) {
    if (error?.code === "ENOENT") {return;}
    throw error;
  }
  throw new Error("PROVIDER_TARGET_DECLARATION_REQUIRED");
}
