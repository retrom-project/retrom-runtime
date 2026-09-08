import {sha256, safePath} from "./provider-sources.mjs";
import {scummvmOutput, unpackScummvmCandidate, validScummvmSource} from "./scummvm-release.mjs";

export function asScummvmCandidateSource(release) {
  const {filename, maxSizeBytes, maxUnpackedSizeBytes, layout} = release.archive ?? {};
  return {id: release.id, repository: release.repository, upstreamCommit: release.upstreamCommit,
    adapterAbi: release.adapterAbi, archive: {filename, maxSizeBytes, maxUnpackedSizeBytes, layout}};
}

export function validScummvmRelease(release) {
  if (!exactKeys(release, ["id", "repository", "upstreamCommit", "adapterAbi", "archive", "tag", "commit", "metadataUrl", "assets"]) ||
    !validScummvmSource(asScummvmCandidateSource(release)) ||
    !/^retrom-core-2026\.3\.0-r[1-9][0-9]*(?:-rc\.[1-9][0-9]*)?$/u.test(release.tag) ||
    !/^[0-9a-f]{40}$/u.test(release.commit) ||
    release.metadataUrl !== `${release.repository}/releases/download/${release.tag}/rpg-runtime-release.json` ||
    !exactKeys(release.archive, ["filename", "maxSizeBytes", "maxUnpackedSizeBytes", "layout", "sizeBytes", "sha256"]) ||
    !/^[0-9a-f]{64}$/u.test(release.archive.sha256) || !Number.isSafeInteger(release.archive.sizeBytes) ||
    release.archive.sizeBytes < 1 || release.archive.sizeBytes > release.archive.maxSizeBytes ||
    !Array.isArray(release.assets) || !release.assets.length || release.assets.length > 4096) {return false;}
  let previous = "";
  for (const asset of release.assets) {
    if (!exactKeys(asset, ["filename", "output", "maxSizeBytes"]) || !safePath(asset.filename) ||
      asset.filename.includes("\\") || [...asset.filename].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || asset.filename <= previous ||
      asset.output !== scummvmOutput(asset.filename) || !Number.isSafeInteger(asset.maxSizeBytes) ||
      asset.maxSizeBytes < 1 || asset.maxSizeBytes > 128 * 1024 * 1024) {return false;}
    previous = asset.filename;
  }
  return true;
}

export function unpackScummvmRelease(release, metadata, bytes, layout) {
  if (!validScummvmRelease(release) ||
    !exactKeys(metadata, ["schemaVersion", "repository", "tag", "commit", "adapterAbi", "digestPolicy", "sourceCommits", "assets"]) ||
    metadata.schemaVersion !== 1 || metadata.repository !== release.repository || metadata.tag !== release.tag ||
    metadata.commit !== release.commit || metadata.adapterAbi !== release.adapterAbi ||
    metadata.digestPolicy !== "OBSERVED_CACHE_INTEGRITY_ONLY" || !exactKeys(metadata.sourceCommits, ["engine"]) ||
    metadata.sourceCommits.engine !== release.upstreamCommit || !Array.isArray(metadata.assets) || metadata.assets.length !== 1) {throw invalid();}
  const asset = metadata.assets[0];
  if (!exactKeys(asset, ["filename", "sizeBytes", "observedSha256"]) || asset.filename !== release.archive.filename ||
    asset.sizeBytes !== release.archive.sizeBytes || asset.observedSha256 !== release.archive.sha256 ||
    bytes.byteLength !== release.archive.sizeBytes || sha256(bytes) !== release.archive.sha256) {throw invalid();}
  const files = unpackScummvmCandidate(asScummvmCandidateSource(release), layout, bytes);
  const expectedAssets = layout.files.map((file) => ({filename: file.path, output: scummvmOutput(file.path), maxSizeBytes: file.maxSizeBytes}));
  if (release.assets.length !== expectedAssets.length || expectedAssets.some((expected, index) => {
    const actual = release.assets[index];
    return actual.filename !== expected.filename || actual.output !== expected.output || actual.maxSizeBytes !== expected.maxSizeBytes;
  })) {throw invalid();}
  return files;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function invalid() {return new Error("SCUMMVM_RELEASE_IDENTITY_INVALID");}
