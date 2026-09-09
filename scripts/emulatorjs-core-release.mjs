import {createHash} from "node:crypto";
import {validEmulatorJsCoreSource} from "./emulatorjs-core-candidate.mjs";

export function validEmulatorJsCoreRelease(release) {
  if (!release || !Array.isArray(release.assets) || release.assets.length !== 3) {return false;}
  const source = {id: release.id, repository: release.repository, adapterAbi: release.adapterAbi,
    files: release.assets.map(({filename, output, sizeBytes, sha256}) => ({filename, output, sizeBytes, sha256}))};
  return validEmulatorJsCoreSource(source) && /^[a-f0-9]{40}$/u.test(release.commit) &&
    /^retrom-core-1\.0-r[1-9][0-9]*(?:-rc\.[1-9][0-9]*)?$/u.test(release.tag) &&
    release.metadataUrl === `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json` &&
    release.assets.every((asset) => asset.url === `${release.repository}/releases/download/${release.tag}/${asset.filename}` &&
      Number.isSafeInteger(asset.maxSizeBytes) && asset.maxSizeBytes >= asset.sizeBytes);
}

export async function readEmulatorJsCoreRelease(release, fetchBytes) {
  if (!validEmulatorJsCoreRelease(release)) {throw invalid();}
  const metadata = JSON.parse(Buffer.from(await fetchBytes(release.metadataUrl, 65536)).toString("utf8"));
  if (metadata.schemaVersion !== 1 || metadata.repository !== release.repository || metadata.tag !== release.tag ||
    metadata.commit !== release.commit || metadata.adapterAbi !== release.adapterAbi ||
    !Array.isArray(metadata.files) || metadata.files.length !== release.assets.length ||
    new Set(metadata.files.map((file) => file.filename)).size !== metadata.files.length) {throw invalid();}
  const result = new Map();
  for (const asset of release.assets) {
    const record = metadata.files.find((file) => file.filename === asset.filename);
    if (!record || record.sha256 !== asset.sha256 || record.sizeBytes !== asset.sizeBytes) {throw invalid();}
    const bytes = await fetchBytes(asset.url, asset.sizeBytes);
    if (!(bytes instanceof Uint8Array) || bytes.length !== asset.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {throw invalid();}
    result.set(asset.output, Buffer.from(bytes));
  }
  return result;
}

function invalid() {return new Error("EMULATORJS_CORE_RELEASE_INVALID");}
