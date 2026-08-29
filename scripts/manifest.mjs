import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function loadManifest(root) {
  const manifest = JSON.parse(await readFile(new URL("runtime-manifest.json", root), "utf8"));
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 2 || manifest.packageName !== "@xxxsen/retrom-runtime" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.packageVersion) ||
    !Array.isArray(manifest.upstreamReleases) || !Array.isArray(manifest.sourceBuilds) ||
    !Array.isArray(manifest.localAssets) || !Array.isArray(manifest.cores) || manifest.cores.length !== 8) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  const releases = new Map();
  const assetPaths = new Set();
  for (const build of manifest.sourceBuilds) {
    if (!build?.id || releases.has(build.id) || !/^https:\/\/github\.com\//u.test(build.repository) ||
      !/^[0-9a-f]{40}$/u.test(build.commit) || !safePath(build.patch) ||
      !Array.isArray(build.assets) || build.assets.length < 2) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    releases.set(build.id, build);
    for (const asset of build.assets) {
      if (!safePath(asset.source) || !safePath(asset.output) || !asset.filename ||
        !Number.isSafeInteger(asset.maxSizeBytes) || asset.maxSizeBytes < 1) {
        throw new Error("RUNTIME_MANIFEST_INVALID");
      }
      assetPaths.add(asset.output);
    }
  }
  for (const release of manifest.upstreamReleases) {
    if (!release?.id || releases.has(release.id) || !/^https:\/\/github\.com\//u.test(release.repository) ||
      !/^[0-9a-f]{40}$/u.test(release.commit) ||
      !/^rpg-runtime-[0-9A-Za-z][0-9A-Za-z._-]*-r[1-9][0-9]*(?:-rc\.[1-9][0-9]*)?$/u.test(release.tag) ||
      release.metadataUrl !==
        `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json` ||
      !Array.isArray(release.assets) || release.assets.length !== 2) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    releases.set(release.id, release);
    for (const asset of release.assets) {
      if (asset.url !== `${release.repository}/releases/download/${release.tag}/${asset.filename}` ||
        !safePath(asset.output) || !Number.isSafeInteger(asset.maxSizeBytes) || asset.maxSizeBytes < 1) {
        throw new Error("RUNTIME_MANIFEST_INVALID");
      }
      assetPaths.add(asset.output);
    }
  }
  for (const asset of manifest.localAssets) {
    if (!safePath(asset.source) || !safePath(asset.output)) {throw new Error("RUNTIME_MANIFEST_INVALID");}
    assetPaths.add(asset.output);
  }
  const generations = new Set();
  for (const core of manifest.cores) {
    if (!core?.id || generations.has(core.generation) || !["RPG_MAKER", "ONS"].includes(core.family) ||
      !core.adapterId || !core.adapterAbi || !versionedIdentity(core.gameCompatibilityLine) ||
      !versionedIdentity(core.saveAbi) || !validReadableSaveAbis(core.saveAbi, core.readableSaveAbis) ||
      core.runtimeId !== "native" && !releases.has(core.runtimeId) || !Array.isArray(core.assetPaths) ||
      !core.assetPaths.length || !core.assetPaths.every((path) => assetPaths.has(path))) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    generations.add(core.generation);
  }
}

function versionedIdentity(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u.test(value);
}

function validReadableSaveAbis(saveAbi, values) {
  return Array.isArray(values) && values.length > 0 && values.length <= 16 &&
    values.every(versionedIdentity) && new Set(values).size === values.length && values.includes(saveAbi);
}

export function safePath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
