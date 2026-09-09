import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {afterEach, expect, it} from "vitest";
import {stageCoreDevelopmentInput, validCoreDevelopmentInput} from "../scripts/core-development-input.mjs";
import {sha256} from "../scripts/provider-sources.mjs";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const source = {id: "px68k", repository: "https://github.com/retrom-project/px68k-libretro",
  upstreamCommit: "a".repeat(40), adapterAbi: "px68k-host-v1", assets: [
    {filename: "core.wasm", output: "runtime/px68k/core.wasm", maxSizeBytes: 32},
    {filename: "LICENSES.txt", output: "licenses/px68k/LICENSES.txt", maxSizeBytes: 32},
  ]};
it("requires bounded assets and retained licenses without invented release tags", () => {
  expect(validCoreDevelopmentInput(source)).toBe(true);
  expect(validCoreDevelopmentInput({...source, tag: "candidate"})).toBe(false);
  expect(validCoreDevelopmentInput({...source, assets: source.assets.slice(0, 1)})).toBe(false);
  expect(validCoreDevelopmentInput({...source, assets: [source.assets[0], {...source.assets[1], output: "licenses/px68k/../LICENSES.txt"}]})).toBe(false);
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "px68k-source-")); roots.push(root);
  const input = join(root, "input"), stage = pathToFileURL(join(root, "stage") + "/");
  await mkdir(input);
  const bytes = Buffer.from("fixture");
  for (const asset of source.assets) {await writeFile(join(input, asset.filename), bytes);}
  const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "px68k", repository: source.repository,
    branch: "feat/px68k", commit: "b".repeat(40), dirty: true, sourceTreeSha256: "c".repeat(64), adapterAbi: source.adapterAbi,
    files: source.assets.map(asset => ({filename: asset.filename, sizeBytes: bytes.length, sha256: sha256(bytes)}))};
  await writeFile(join(input, "retrom-core-candidate.json"), JSON.stringify(descriptor));
  return {input, stage, descriptor};
}
it("stages only descriptor-verified bytes", async () => {
  const f = await fixture();
  expect(await stageCoreDevelopmentInput(source, f.input, f.stage)).toEqual(source.assets.map(asset => asset.output));
});
it.each(["digest", "extra", "abi"])("rejects %s mismatches before a candidate can be packaged", async problem => {
  const f = await fixture();
  if (problem === "digest") {await writeFile(join(f.input, "core.wasm"), "corrupt");}
  if (problem === "extra") {await writeFile(join(f.input, "undeclared"), "extra");}
  if (problem === "abi") {
    await writeFile(join(f.input, "retrom-core-candidate.json"), JSON.stringify({...f.descriptor, adapterAbi: "wrong"}));
  }
  await expect(stageCoreDevelopmentInput(source, f.input, f.stage)).rejects.toThrow("CORE_CANDIDATE_INVALID");
});
