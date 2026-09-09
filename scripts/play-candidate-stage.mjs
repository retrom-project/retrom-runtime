import {lstat, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {sha256} from "./provider-sources.mjs";

export const playFiles = {"LICENSE": 131072, "Play.js": 8 * 1024 * 1024, "Play.wasm": 64 * 1024 * 1024,
  "checkpoint.mjs": 65536, "input.mjs": 65536, "play-retrom.mjs": 65536, "range-device.mjs": 65536};

export function validPlaySource(source) {
  return source && Object.keys(source).sort().join() === "adapterAbi,id,repository,upstreamCommit" &&
    source.id === "play" && source.repository === "https://github.com/retrom-project/Play-" &&
    source.adapterAbi === "play-host-v1" && /^[0-9a-f]{40}$/u.test(source.upstreamCommit);
}

export async function stagePlayCandidate(source, directory, stage) {
  if (!validPlaySource(source) || !directory) {throw new Error("UNPUBLISHED_CORE_INPUT:play");}
  const descriptor = JSON.parse(await readBounded(join(directory, "retrom-core-candidate.json"), 65536));
  if (descriptor.schemaVersion !== 1 || descriptor.kind !== "RETROM_CORE_CANDIDATE_V1" ||
    descriptor.coreId !== source.id || descriptor.repository !== source.repository || descriptor.adapterAbi !== source.adapterAbi ||
    !/^[0-9a-f]{40}$/u.test(descriptor.commit) || !/^[0-9a-f]{64}$/u.test(descriptor.sourceTreeSha256) ||
    typeof descriptor.dirty !== "boolean" || !/^(feat|fix|build)\//u.test(descriptor.branch) ||
    !Array.isArray(descriptor.files)) {throw invalid();}
  const expected = Object.keys(playFiles).sort();
  if (descriptor.files.map(file => file.filename).join() !== expected.join() ||
    (await readdir(directory)).sort().join() !== [...expected, "retrom-core-candidate.json"].sort().join()) {throw invalid();}
  const outputs = [];
  for (const file of descriptor.files) {
    const bytes = await readBounded(join(directory, file.filename), playFiles[file.filename]);
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw invalid();}
    const output = file.filename === "LICENSE" ? "licenses/play/LICENSE" : `runtime/play/${file.filename}`;
    const target = new URL(output, stage);
    await mkdir(new URL(".", target), {recursive: true});
    await writeFile(target, bytes); outputs.push(output);
  }
  return outputs.sort();
}

async function readBounded(path, maximum) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) {throw invalid();}
  return readFile(path);
}
function invalid() {return new Error("PLAY_CANDIDATE_INVALID");}
