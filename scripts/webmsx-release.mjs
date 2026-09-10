import {mkdir, writeFile} from "node:fs/promises";
import {asWebMSXCandidateSource} from "./webmsx-candidate.mjs";
import {sha256} from "./provider-sources.mjs";

export function validWebMSXRelease(release) {
  try {asWebMSXCandidateSource(release);} catch {return false;}
  return /^retrom-core-6\.0\.8-r[1-9][0-9]*(?:-rc\.[1-9][0-9]*)?$/u.test(release.tag) &&
    release.upstreamCommit === "4f4009e86d3e0bb9be7dcd7f0a582b0cd411d660" &&
    /^[0-9a-f]{40}$/u.test(release.commit) &&
    release.metadataUrl === `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json` &&
    release.assets.every((asset) => /^[0-9a-f]{64}$/u.test(asset.sha256) &&
      Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 && asset.sizeBytes <= asset.maxSizeBytes);
}

export async function stageWebMSXRelease(release, metadata, download, stage) {
  if (!validWebMSXRelease(release) || metadata?.schemaVersion !== 1 ||
    metadata.repository !== release.repository || metadata.tag !== release.tag ||
    metadata.commit !== release.commit || metadata.adapterAbi !== release.adapterAbi ||
    metadata.upstreamRepository !== "https://github.com/ppeccin/WebMSX" ||
    metadata.upstreamCommit !== release.upstreamCommit ||
    metadata.licenseStatus !== "UNRESOLVED" || metadata.systemRomDistributionStatus !== "UNRESOLVED" ||
    !/^[0-9a-f]{64}$/u.test(metadata.sourceTreeSha256) || !Array.isArray(metadata.files) ||
    metadata.files.length !== release.assets.length || metadata.files.some((file, i) =>
      file.filename !== release.assets[i].filename || file.sizeBytes !== release.assets[i].sizeBytes ||
      file.sha256 !== release.assets[i].sha256)) {throw new Error("WEBMSX_RELEASE_METADATA_INVALID");}
  const verified = [];
  for (const asset of release.assets) {
    const bytes = await download(asset.url, asset.sizeBytes);
    if (bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) {
      throw new Error("WEBMSX_RELEASE_ASSET_INVALID");
    }
    verified.push([asset.output, bytes]);
  }
  for (const [path, bytes] of verified) {
    const target = new URL(path, stage);
    await mkdir(new URL(".", target), {recursive: true}); await writeFile(target, bytes);
  }
}
