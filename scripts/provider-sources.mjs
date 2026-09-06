import { validJ2meRelease } from "./j2me-release.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function loadProviderSources(root) {
  const sources = JSON.parse(await readFile(new URL("provider-sources.json", root), "utf8"));
  validateProviderSources(sources);
  return sources;
}

export function validateProviderSources(sources) {
  if (sources?.schemaVersion !== 1 || sources.publicApiVersion !== 2 ||
    sources.packageName !== "@xxxsen/retrom-runtime" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(sources.packageVersion) ||
    Object.keys(sources).sort().join(",") !==
      "localAssets,packageName,packageVersion,publicApiVersion,schemaVersion,upstreamReleases" ||
    !Array.isArray(sources.upstreamReleases) || !Array.isArray(sources.localAssets)) {
    throw new Error("PROVIDER_SOURCES_INVALID");
  }
  const releases = new Map();
  const assetPaths = new Set();
  for (const release of sources.upstreamReleases) {
    if (!release?.id || releases.has(release.id) ||
      !/^https:\/\/github\.com\/retrom-project\/[A-Za-z0-9._-]+$/u.test(release.repository) ||
      !/^[0-9a-f]{40}$/u.test(release.commit) ||
      !(release.archive ? validJ2meRelease(release) : validCoreRelease(release))) {
      throw new Error("PROVIDER_SOURCES_INVALID");
    }
    releases.set(release.id, release);
    for (const asset of release.assets) {
      if (!safePath(asset.filename) ||
        (!release.archive && asset.url !== `${release.repository}/releases/download/${release.tag}/${asset.filename}`) ||
        !safePath(asset.output) || !Number.isSafeInteger(asset.maxSizeBytes) || asset.maxSizeBytes < 1) {
        throw new Error("PROVIDER_SOURCES_INVALID");
      }
      assetPaths.add(asset.output);
    }
  }
  for (const asset of sources.localAssets) {
    if (!safePath(asset.source) || !safePath(asset.output)) {throw new Error("PROVIDER_SOURCES_INVALID");}
    assetPaths.add(asset.output);
  }
}

export function safePath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function validCoreRelease(release) {
  return /^retrom-core-[0-9A-Za-z][0-9A-Za-z._-]*-r[1-9][0-9]*(?:-rc\.[1-9][0-9]*)?$/u.test(release.tag) &&
    release.metadataUrl === `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json` &&
    Array.isArray(release.assets) && release.assets.length >= 2 && release.assets.length <= 8;
}
