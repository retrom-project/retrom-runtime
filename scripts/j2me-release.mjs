import {unzipSync} from "fflate";
import {safePath, sha256} from "./provider-sources.mjs";

const archiveLimit = 64 * 1024 * 1024;
const expandedLimit = 128 * 1024 * 1024;

export function validJ2meRelease(release) {
  const archive = release.archive;
  return release.id === "j2me" && release.repository === "https://github.com/retrom-project/j2me-web" &&
    /^v\d+\.\d+\.\d+$/u.test(release.tag) &&
    release.metadataUrl === `${release.repository}/releases/download/${release.tag}/j2me-runtime-release.json` &&
    [release.repository, "https://github.com/xxxsen/j2me-web"].includes(release.metadataRepository) &&
    release.adapterAbi === "j2me-rms" && archive?.format === "zip" && safePath(archive.filename) &&
    !archive.filename.includes("/") && safePath(archive.rootDirectory) && !archive.rootDirectory.includes("/") &&
    /^[0-9a-f]{64}$/u.test(archive.sha256) && Number.isSafeInteger(archive.sizeBytes) &&
    archive.sizeBytes > 0 && archive.sizeBytes <= archiveLimit &&
    Array.isArray(release.assets) && release.assets.length === 9;
}

export function unpackJ2meRelease(release, metadata, bytes) {
  if (!validJ2meRelease(release) || metadata?.schemaVersion !== 2 ||
    metadata.repository !== release.metadataRepository || metadata.tag !== release.tag ||
    metadata.commit !== release.commit || metadata.adapterAbi !== release.adapterAbi ||
    metadata.artifact?.format !== "zip" || metadata.artifact.filename !== release.archive.filename ||
    metadata.artifact.rootDirectory !== release.archive.rootDirectory ||
    metadata.artifact.sizeBytes !== release.archive.sizeBytes ||
    metadata.artifact.observedSha256 !== release.archive.sha256 ||
    bytes.byteLength !== release.archive.sizeBytes || sha256(bytes) !== release.archive.sha256) {
    throw new Error("J2ME_RELEASE_IDENTITY_INVALID");
  }
  const records = validateAssetRecords(metadata.assets);
  const files = extractFiles(bytes, `${release.archive.rootDirectory}/`);
  const result = new Map();
  for (const asset of release.assets) {
    const contents = files[`${release.archive.rootDirectory}/${asset.filename}`];
    if (!contents?.length || contents.length > asset.maxSizeBytes) {throw new Error("J2ME_RELEASE_ASSET_INVALID");}
    // Notices are protected by the pinned whole-archive digest; runtime bytes also have individual digests.
    const record = records.get(asset.filename);
    if (asset.filename !== "THIRD_PARTY_NOTICES.md" &&
      (!record || contents.length !== record.sizeBytes || sha256(contents) !== record.observedSha256)) {
      throw new Error("J2ME_RELEASE_ASSET_INVALID");
    }
    result.set(asset.filename, contents);
  }
  return result;
}

function validateAssetRecords(assets) {
  if (!Array.isArray(assets) || assets.length !== 8) {throw new Error("J2ME_RELEASE_ASSET_INVALID");}
  const records = new Map();
  for (const asset of assets) {
    if (!safePath(asset?.filename) || records.has(asset.filename) || !/^[0-9a-f]{64}$/u.test(asset.observedSha256) ||
      !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1 || asset.sizeBytes > expandedLimit) {
      throw new Error("J2ME_RELEASE_ASSET_INVALID");
    }
    records.set(asset.filename, asset);
  }
  return records;
}

function extractFiles(bytes, prefix) {
  let total = 0;
  const names = new Set();
  return unzipSync(bytes, {filter: (entry) => {
    const name = entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name;
    total += entry.originalSize;
    if (!safePath(name) || name.includes("\\") || names.has(entry.name) ||
      !entry.name.startsWith(prefix) || total > expandedLimit) {
      throw new Error("J2ME_RELEASE_ARCHIVE_INVALID");
    }
    names.add(entry.name);
    return !entry.name.endsWith("/");
  }});
}
