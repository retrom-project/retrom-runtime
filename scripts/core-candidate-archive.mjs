import {createHash} from "node:crypto";
import {lstat, readFile, readdir} from "node:fs/promises";
import {join} from "node:path";
import {zipSync, unzipSync} from "fflate";

export function validCandidateArchive(value) {
  return value && Object.keys(value).sort().join() === "filename,sha256,sizeBytes,sourceTreeSha256" &&
    /^[a-z0-9][a-z0-9.-]*\.zip$/u.test(value.filename) && Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 && value.sizeBytes <= 128 * 1024 * 1024 &&
    /^[a-f0-9]{64}$/u.test(value.sha256) && /^[a-f0-9]{64}$/u.test(value.sourceTreeSha256);
}
export async function packCoreCandidateDirectory(directory) {
  const files = {};
  for (const filename of (await readdir(directory)).sort()) {
    if (!/^[A-Za-z0-9._-]+$/u.test(filename)) {invalid();}
    const path = join(directory, filename), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 128 * 1024 * 1024) {invalid();}
    files[filename] = [await readFile(path), {mtime: new Date(1980, 0, 1, 0, 0, 0)}];
  }
  return zipSync(files, {level: 9});
}
export async function verifyPinnedCoreDirectory(source, directory, descriptor) {
  if (!source.candidateArchive) {return;}
  if (descriptor.sourceTreeSha256 !== source.candidateArchive.sourceTreeSha256) {invalid();}
  verifyBytes(source.candidateArchive, await packCoreCandidateDirectory(directory));
}
export function unpackPinnedCoreArchive(source, bytes) {
  verifyBytes(source.candidateArchive, bytes);
  const limits = new Map(source.assets.map(asset => [asset.filename, asset.maxSizeBytes]));
  limits.set("retrom-core-candidate.json", 65536);
  const seen = new Set();
  const files = unzipSync(bytes, {filter(entry) {
    if (seen.has(entry.name) || !limits.has(entry.name) || entry.originalSize < 1 ||
      entry.originalSize > limits.get(entry.name)) {invalid();}
    seen.add(entry.name); return true;
  }});
  if (seen.size !== limits.size || Object.entries(files).some(([name, data]) => data.length > limits.get(name))) {invalid();}
  return files;
}
function verifyBytes(pin, bytes) {
  if (!validCandidateArchive(pin) || bytes.length !== pin.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== pin.sha256) {invalid();}
}
function invalid() {throw new Error("CORE_CANDIDATE_ARCHIVE_INVALID");}
