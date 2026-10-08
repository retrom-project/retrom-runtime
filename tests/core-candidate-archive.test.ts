// @vitest-environment node
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {afterEach, expect, it} from "vitest";
import {packCoreCandidateDirectory, unpackPinnedCoreArchive} from "../scripts/core-candidate-archive.mjs";
import {stageCoreDevelopmentInput} from "../scripts/core-development-input.mjs";
import {prepareCoreCandidates} from "../scripts/prepare-core-candidates.mjs";
import {sha256} from "../scripts/provider-sources.mjs";
import {assertONSCheckpointCore} from "../scripts/ons-core-abi.mjs";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "core-pinned-")); roots.push(root);
  const input = join(root, "input"); await mkdir(input);
  const assets = [{filename: "core.wasm", output: "runtime/ons/core.wasm", maxSizeBytes: 32},
    {filename: "COPYING", output: "licenses/onsyuri/COPYING", maxSizeBytes: 32}];
  const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "onsyuri",
    repository: "https://github.com/retrom-project/OnscripterYuri", branch: "fix/native", commit: "b".repeat(40),
    dirty: true, sourceTreeSha256: "c".repeat(64), adapterAbi: "ons-save",
    files: assets.map(asset => ({filename: asset.filename, sizeBytes: 7, sha256: sha256("fixture")}))};
  for (const asset of assets) {await writeFile(join(input, asset.filename), "fixture");}
  await writeFile(join(input, "retrom-core-candidate.json"), JSON.stringify(descriptor));
  const archive = await packCoreCandidateDirectory(input);
  const source = {id: descriptor.coreId, repository: descriptor.repository, upstreamCommit: "a".repeat(40),
    adapterAbi: descriptor.adapterAbi, assets, candidateArchive: {filename: "onsyuri-fixed.zip", sizeBytes: archive.length,
      sha256: sha256(archive), sourceTreeSha256: descriptor.sourceTreeSha256}};
  await writeFile(join(root, source.candidateArchive.filename), archive);
  return {root, input, source, archive};
}
it("uses one hash-pinned local transport and stages the descriptor's exact bytes", async () => {
  const f = await fixture(), outputRoot = join(f.root, "prepared");
  expect(await packCoreCandidateDirectory(f.input)).toEqual(f.archive);
  expect(await prepareCoreCandidates({sources: {developmentInputs: [f.source]}, archiveRoot: f.root, outputRoot}))
    .toEqual({onsyuri: join(outputRoot, "onsyuri")});
  expect(await readFile(join(outputRoot, "onsyuri/core.wasm"), "utf8")).toBe("fixture");
});
it("rejects byte tampering or an invented source-tree claim", async () => {
  const f = await fixture();
  expect(() => unpackPinnedCoreArchive(f.source, new Uint8Array([1]))).toThrow("CORE_CANDIDATE_ARCHIVE_INVALID");
  await expect(stageCoreDevelopmentInput({...f.source,
    candidateArchive: {...f.source.candidateArchive, sourceTreeSha256: "d".repeat(64)}},
  f.input, pathToFileURL(`${f.root}/stage/`))).rejects.toThrow("CORE_CANDIDATE_ARCHIVE_INVALID");
});
it("writes identical ZIP DOS timestamps in independent UTC, Shanghai and Los Angeles processes", async () => {
  const f = await fixture(), module = new URL("../scripts/core-candidate-archive.mjs", import.meta.url).href;
  const code = `import {packCoreCandidateDirectory} from ${JSON.stringify(module)};
    import {createHash} from 'node:crypto';
    process.stdout.write(createHash('sha256').update(await packCoreCandidateDirectory(process.argv[1])).digest('hex'));`;
  const hashes = ["UTC", "Asia/Shanghai", "America/Los_Angeles"].map(TZ => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, f.input], {
      env: {...process.env, TZ}, encoding: "utf8", timeout: 10000,
    });
    expect(child.status, child.stderr).toBe(0); return child.stdout;
  });
  expect(hashes).toEqual([sha256(f.archive), sha256(f.archive), sha256(f.archive)]);
});
it("fails explicitly when no transport is provided", async () => {
  const f = await fixture();
  await expect(prepareCoreCandidates({sources: {developmentInputs: [f.source]}, outputRoot: join(f.root, "missing")}))
    .rejects.toThrow("CORE_CANDIDATE_TRANSPORT_REQUIRED");
});
it("requires the JS checkpoint binding to resolve to a real native WASM function", () => {
  const wasm = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,5,1,1,102,0,0,10,4,1,2,0,11]);
  expect(() => assertONSCheckpointCore(Buffer.from('Module["_onsyuri_host_checkpoint_ready"]=wasmExports["f"]'), wasm)).not.toThrow();
  expect(() => assertONSCheckpointCore(Buffer.from("Module={}"), wasm)).toThrow("ONS_CHECKPOINT_NATIVE_ABI_REQUIRED");
  expect(() => assertONSCheckpointCore(Buffer.from('Module["_onsyuri_host_checkpoint_ready"]=wasmExports["missing"]'), wasm))
    .toThrow("ONS_CHECKPOINT_NATIVE_ABI_REQUIRED");
});
