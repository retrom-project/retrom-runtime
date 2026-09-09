import {lstat, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
const files = {"LICENSE": 1048576, "font.bmp": 524350, "np2kai-register.mjs": 65536, "np2kai.mjs": 8388608, "np2kai.wasm": 33554432};
export function validNP2Source(value) {
  return value && Object.keys(value).sort().join() === "adapterAbi,id,repository,upstreamCommit" &&
    value.id === "np2kai" && value.repository === "https://github.com/retrom-project/NP2kai" &&
    value.adapterAbi === "np2kai-host-v1" && /^[0-9a-f]{40}$/u.test(value.upstreamCommit);
}
export async function stageNP2Candidate(source, directory, stage) {
  if (!validNP2Source(source) || !directory) {throw invalid();}
  const descriptor = JSON.parse(await boundedRead(join(directory, "retrom-core-candidate.json"), 65536));
  if (descriptor?.schemaVersion !== 1 || descriptor.kind !== "RETROM_CORE_CANDIDATE_V1" ||
      descriptor.coreId !== source.id || descriptor.repository !== source.repository || descriptor.adapterAbi !== source.adapterAbi ||
      !/^[0-9a-f]{40}$/u.test(descriptor.commit) || !/^[0-9a-f]{64}$/u.test(descriptor.sourceTreeSha256) ||
      typeof descriptor.dirty !== "boolean" || typeof descriptor.branch !== "string" || !descriptor.branch ||
      !Array.isArray(descriptor.files) || descriptor.files.length !== Object.keys(files).length) {throw invalid();}
  const names = Object.keys(files).sort();
  if (JSON.stringify(descriptor.files.map(file => file.filename)) !== JSON.stringify(names) ||
      JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([...names, "retrom-core-candidate.json"].sort())) {throw invalid();}
  const outputs = [];
  for (const record of descriptor.files) {
    const bytes = await boundedRead(join(directory, record.filename), files[record.filename]);
    if (record.sizeBytes !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== record.sha256) {throw invalid();}
    const output = record.filename === "LICENSE" ? "licenses/np2kai/LICENSE" : `runtime/np2kai/${record.filename}`;
    const target = new URL(output, stage); await mkdir(new URL(".", target), {recursive: true});
    await writeFile(target, bytes); outputs.push(output);
  }
  const provenance = "licenses/np2kai/retrom-core-candidate.json";
  await writeFile(new URL(provenance, stage), JSON.stringify(descriptor) + "\n");
  return [...outputs, provenance].sort();
}
async function boundedRead(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum) {throw invalid();}
  return readFile(path);
}
function invalid() {return new Error("NP2KAI_CANDIDATE_INVALID");}
