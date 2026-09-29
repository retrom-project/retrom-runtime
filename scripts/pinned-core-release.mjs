import {mkdir, writeFile} from "node:fs/promises";
import {unzipSync} from "fflate";
import {sha256} from "./provider-sources.mjs";

const mameExpandedLimit = 384 * 1024 * 1024;

export function validMameRelease(release) {
  const archive = release.archive;
  return release.id === "mame" && release.repository === "https://github.com/retrom-project/mame" &&
    /^retrom-core-gf65d5ba9bc42-r[2-9][0-9]*$/u.test(release.tag) &&
    release.metadataUrl === `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json` &&
    release.adapterAbi === "retrom-mame-dylink-v1" &&
    archive?.filename === "mame-current-assets.zip" && archive.format === "zip" &&
    archive.url === `${release.repository}/releases/download/${release.tag}/${archive.filename}` &&
    /^[0-9a-f]{64}$/u.test(archive.sha256) && Number.isSafeInteger(archive.sizeBytes) &&
    archive.sizeBytes > 0 && archive.sizeBytes <= 256 * 1024 * 1024 &&
    Array.isArray(release.assets) && release.assets.length >= 3 && release.assets.length <= 256 &&
    release.assets.every(asset => asset.output === (asset.filename === "LICENSES.txt"
      ? "licenses/mame/LICENSES.txt" : `runtime/mame/${asset.filename}`) &&
      /^[A-Za-z0-9._-]+$/u.test(asset.filename) && asset.url === undefined) &&
    new Set(release.assets.map(asset => asset.filename)).size === release.assets.length;
}

export function usesPinnedCoreAssets(id) {
  return ["np2kai", "px68k", "tyranoscript", "openbor", "gbe_plus", "nxengine", "ppsspp", "mame"].includes(id);
}
export async function stagePinnedCoreIfNeeded(release, metadata, download, stage) {
  if (!usesPinnedCoreAssets(release.id)) {return false;}
  await stagePinnedCoreRelease(release, metadata, download, stage);
  return true;
}

export function validPinnedCoreAssets(release) {
  return Array.isArray(release.assets) && release.assets.length > 0 &&
    release.assets.every(asset => /^[0-9a-f]{64}$/u.test(asset.sha256) &&
      Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 && asset.sizeBytes <= asset.maxSizeBytes);
}
export async function stagePinnedCoreRelease(release, metadata, download, stage) {
  if (!validPinnedCoreAssets(release) || metadata?.schemaVersion !== 1 ||
    metadata.repository !== release.repository || metadata.tag !== release.tag ||
    metadata.commit !== release.commit || metadata.adapterAbi !== release.adapterAbi ||
    !Array.isArray(metadata.files) || metadata.files.length !== release.assets.length ||
    release.assets.some(asset => metadata.files.filter(file => file.filename === asset.filename &&
      file.sizeBytes === asset.sizeBytes && file.sha256 === asset.sha256).length !== 1)) {
    throw new Error("PINNED_CORE_METADATA_INVALID");
  }
  const verified = [];
  if (release.id === "mame") {
    if (!validMameRelease(release) || metadata.archive?.filename !== release.archive.filename ||
      metadata.archive?.format !== "zip" || metadata.archive.sizeBytes !== release.archive.sizeBytes ||
      metadata.archive.sha256 !== release.archive.sha256) {throw new Error("PINNED_CORE_METADATA_INVALID");}
    const rawNames = release.assets.map(asset => asset.filename).sort();
    if (JSON.stringify(metadata.archive.files) !== JSON.stringify(rawNames)) {
      throw new Error("PINNED_CORE_METADATA_INVALID");
    }
    const archive = await download(release.archive.url, release.archive.sizeBytes);
    if (archive.length !== release.archive.sizeBytes || sha256(archive) !== release.archive.sha256) {
      throw new Error("PINNED_CORE_ARCHIVE_INVALID");
    }
    let total = 0;
    const names = new Set();
    let files;
    try {
      files = unzipSync(archive, {filter: entry => {
        total += entry.originalSize;
        if (!rawNames.includes(entry.name) || names.has(entry.name) ||
          entry.originalSize < 1 || total > mameExpandedLimit) {throw new Error("PINNED_CORE_ARCHIVE_INVALID");}
        names.add(entry.name);
        return true;
      }});
    } catch {throw new Error("PINNED_CORE_ARCHIVE_INVALID");}
    if (names.size !== rawNames.length) {throw new Error("PINNED_CORE_ARCHIVE_INVALID");}
    for (const asset of release.assets) {
      const bytes = files[asset.filename];
      if (!bytes || bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) {
        throw new Error("PINNED_CORE_ASSET_INVALID");
      }
      verified.push([asset.output, bytes]);
    }
  } else {
    for (const asset of release.assets) {
      const bytes = await download(asset.url, asset.sizeBytes);
      if (bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) {throw new Error("PINNED_CORE_ASSET_INVALID");}
      verified.push([asset.output, bytes]);
    }
  }
  for (const [path, bytes] of verified) {
    const target = new URL(path, stage);
    await mkdir(new URL(".", target), {recursive: true}); await writeFile(target, bytes);
  }
}
