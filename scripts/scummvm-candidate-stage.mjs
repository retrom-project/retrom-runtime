import {lstat, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {sha256} from "./provider-sources.mjs";
import {scummvmOutput, unpackScummvmCandidate} from "./scummvm-release.mjs";

/** Consume only fork-owned, explicitly built bytes. This script never builds a core. */
export async function stageScummvmCandidate(source, directory, root, stage) {
  if (!directory) {throw new Error("UNPUBLISHED_CORE_INPUT");}
  const descriptor = JSON.parse(await boundedRead(join(directory, "retrom-core-candidate.json"), 65536));
  if (descriptor?.schemaVersion !== 1 || descriptor.kind !== "RETROM_CORE_CANDIDATE_V1" ||
    descriptor.coreId !== source.id || descriptor.repository !== source.repository || descriptor.adapterAbi !== source.adapterAbi ||
    !/^[0-9a-f]{40}$/u.test(descriptor.commit) || !/^[0-9a-f]{64}$/u.test(descriptor.sourceTreeSha256) ||
    typeof descriptor.dirty !== "boolean" || typeof descriptor.branch !== "string" || !descriptor.branch ||
    !Array.isArray(descriptor.files) || descriptor.files.length !== 1) {throw invalid();}
  const file = descriptor.files[0];
  if (file.filename !== source.archive.filename || !Number.isSafeInteger(file.sizeBytes) ||
    file.sizeBytes < 1 || file.sizeBytes > source.archive.maxSizeBytes || !/^[0-9a-f]{64}$/u.test(file.sha256)) {throw invalid();}
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([file.filename, "retrom-core-candidate.json"].sort())) {throw invalid();}
  const bytes = await boundedRead(join(directory, file.filename), source.archive.maxSizeBytes);
  if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw invalid();}
  const layout = JSON.parse(await boundedRead(new URL(source.archive.layout, root), 1024 * 1024));
  const outputs = [];
  for (const [path, content] of unpackScummvmCandidate(source, layout, bytes)) {
    const output = scummvmOutput(path);
    const target = new URL(output, stage);
    await mkdir(new URL(".", target), {recursive: true});
    await writeFile(target, content);
    outputs.push(output);
  }
  return outputs.sort();
}
async function boundedRead(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum) {throw invalid();}
  return readFile(path);
}
function invalid() {return new Error("SCUMMVM_CANDIDATE_INVALID");}
