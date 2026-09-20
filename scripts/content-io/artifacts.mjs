import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {readdir, lstat, realpath} from "node:fs/promises";
import {join} from "node:path";
import {requireProof} from "./result-format.mjs";

export async function artifactFiles(directory) {
  requireProof(await realpath(directory) === directory, "EVIDENCE_ROOT_INVALID");
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await artifactFiles(path));
    else {requireProof(entry.isFile() && !entry.isSymbolicLink(), "EVIDENCE_PATH_INVALID"); files.push(path);}
  }
  return files.sort();
}
export async function artifactDigest(path) {
  const info = await lstat(path);
  requireProof(info.isFile() && !info.isSymbolicLink() && await realpath(path) === path, "EVIDENCE_PATH_INVALID");
  const digest = createHash("sha256"); let sizeBytes = 0;
  for await (const bytes of createReadStream(path)) {digest.update(bytes); sizeBytes += bytes.length;}
  requireProof(sizeBytes === info.size, "EVIDENCE_CHANGED_DURING_READ");
  return {path, kind: "ARTIFACT", sizeBytes, sha256: digest.digest("hex")};
}
export async function captureArtifacts(result, runRoot) {
  const registered = new Set(result.outputs.map(row => row.path));
  for (const path of await artifactFiles(runRoot)) {
    if (!registered.has(path) && path !== join(runRoot, "result.json")) result.outputs.push(await artifactDigest(path));
  }
}
