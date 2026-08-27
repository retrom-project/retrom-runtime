import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function loadManifest(root) {
  const manifest = JSON.parse(await readFile(new URL("runtime-manifest.json", root), "utf8"));
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.packageName !== "@xxxsen/retrom-runtime" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.packageVersion) ||
    !Array.isArray(manifest.upstreamReleases) || !Array.isArray(manifest.localAssets) ||
    !Array.isArray(manifest.cores) || manifest.cores.length !== 7) {
    throw new Error("RUNTIME_MANIFEST_INVALID");
  }
  const releases = new Map();
  const assetPaths = new Set();
  for (const release of manifest.upstreamReleases) {
    if (!release?.id || releases.has(release.id) || !/^https:\/\/github\.com\//u.test(release.repository) ||
      !/^[0-9a-f]{40}$/u.test(release.commit) || !Array.isArray(release.assets) || release.assets.length !== 2) {
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
    if (!core?.id || generations.has(core.generation) || !core.adapterId || !core.adapterAbi ||
      core.runtimeId !== "native" && !releases.has(core.runtimeId) || !Array.isArray(core.assetPaths) ||
      !core.assetPaths.length || !core.assetPaths.every((path) => assetPaths.has(path))) {
      throw new Error("RUNTIME_MANIFEST_INVALID");
    }
    generations.add(core.generation);
  }
}

export function safePath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
