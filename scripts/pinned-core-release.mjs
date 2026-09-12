import {mkdir, writeFile} from "node:fs/promises";
import {sha256} from "./provider-sources.mjs";

export function usesPinnedCoreAssets(id) {
  return ["np2kai", "px68k", "tyranoscript", "openbor", "gbe_plus", "nxengine", "ppsspp"].includes(id);
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
  for (const asset of release.assets) {
    const bytes = await download(asset.url, asset.sizeBytes);
    if (bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) {throw new Error("PINNED_CORE_ASSET_INVALID");}
    verified.push([asset.output, bytes]);
  }
  for (const [path, bytes] of verified) {
    const target = new URL(path, stage);
    await mkdir(new URL(".", target), {recursive: true}); await writeFile(target, bytes);
  }
}
