import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function loadManifest(root) {
  const manifest = JSON.parse(await readFile(new URL("runtime-manifest.json", root), "utf8"));
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 4 || manifest.publicApiVersion !== 2 ||
    manifest.packageName !== "@xxxsen/retrom-runtime" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.packageVersion) ||
    Object.hasOwn(manifest, "sourceBuilds") || !Array.isArray(manifest.upstreamReleases) ||
    !Array.isArray(manifest.localAssets) || !Array.isArray(manifest.adapters) || manifest.adapters.length !== 6 ||
    !Array.isArray(manifest.cores) || manifest.cores.length !== 10) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  const releases = new Map();
  const assetPaths = new Set();
  for (const release of manifest.upstreamReleases) {
    if (!release?.id || releases.has(release.id) || !/^https:\/\/github\.com\//u.test(release.repository) ||
      !/^[0-9a-f]{40}$/u.test(release.commit) ||
      !/^rpg-runtime-[0-9A-Za-z][0-9A-Za-z._-]*-r[1-9][0-9]*(?:-rc\.[1-9][0-9]*)?$/u.test(release.tag) ||
      release.metadataUrl !==
        `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json` ||
      !Array.isArray(release.assets) || release.assets.length < 2 || release.assets.length > 8) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    releases.set(release.id, release);
    for (const asset of release.assets) {
      if (!safePath(asset.filename) ||
        asset.url !== `${release.repository}/releases/download/${release.tag}/${asset.filename}` ||
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
  const adapters = new Map();
  for (const adapter of manifest.adapters) {
    if (!adapter?.adapterKind || adapters.has(adapter.adapterKind) || !adapter.adapterId || !adapter.adapterAbi ||
      !/^[a-z0-9][a-z0-9.-]{0,63}$/u.test(adapter.checkpointFormat) ||
      !validCapabilities(adapter.capabilities)) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    adapters.set(adapter.adapterKind, adapter);
  }
  const generations = new Set();
  for (const core of manifest.cores) {
    const adapter = adapters.get(core?.adapterKind);
    if (!core?.id || generations.has(core.generation) ||
      !["RPG_MAKER", "ONS", "KIRIKIRI", "BUTTERSCOTCH"].includes(core.family) ||
      !adapter || core.adapterId !== adapter.adapterId || core.adapterAbi !== adapter.adapterAbi ||
      !versionedIdentity(core.gameCompatibilityLine) ||
      !versionedIdentity(core.saveAbi) || !validReadableSaveAbis(core.saveAbi, core.readableSaveAbis) ||
      core.runtimeId !== "native" && !releases.has(core.runtimeId) || !Array.isArray(core.assetPaths) ||
      !core.assetPaths.length || !core.assetPaths.every((path) => assetPaths.has(path))) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    generations.add(core.generation);
  }
}

function validCapabilities(value) {
  return value && typeof value === "object" &&
    ["pause", "screenshot", "checkpoint", "standardGamepad", "frameCounter", "volume"]
      .every((key) => typeof value[key] === "boolean") &&
    value.checkpoint && value.standardGamepad && Array.isArray(value.validationProbes) &&
    value.validationProbes.length <= 16 && new Set(value.validationProbes).size === value.validationProbes.length &&
    value.validationProbes.every((probe) => /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.v[1-9][0-9]*$/u.test(probe));
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
