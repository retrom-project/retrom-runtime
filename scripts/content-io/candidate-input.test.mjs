import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {hash} from "./evidence.mjs";
import {verifyCoreInput} from "./prepare-candidate-inputs.mjs";

test("[PK-05] CONTRACT/candidate [X-20] CONTRACT/candidate core inputs require exact source identity, ABI, inventory and bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "content-io-candidate-"));
  const bytes = Buffer.from("candidate bytes");
  const identity = {commit: "a".repeat(40), branch: "feat/content", dirty: true, sourceTreeSha256: "b".repeat(64)};
  const source = {repository: "https://github.com/retrom-project/core", adapterAbi: "core-content-io-v1",
    assets: [{filename: "core.wasm", maxSizeBytes: 100}]};
  const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "core", ...identity,
    repository: source.repository, adapterAbi: source.adapterAbi,
    files: [{filename: "core.wasm", sha256: hash(bytes), sizeBytes: bytes.length}]};
  const save = value => writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify(value));
  try {
    await writeFile(join(directory, "core.wasm"), bytes); await save(descriptor);
    assert.equal((await verifyCoreInput("core", directory, source, identity)).descriptor.sourceTreeSha256, identity.sourceTreeSha256);
    for (const patch of [{adapterAbi: "old"}, {sourceTreeSha256: "c".repeat(64)}, {dirty: false}]) {
      await save({...descriptor, ...patch});
      await assert.rejects(verifyCoreInput("core", directory, source, identity), /IDENTITY_INVALID/u);
    }
    await save(descriptor); await writeFile(join(directory, "core.wasm"), "wrong");
    await assert.rejects(verifyCoreInput("core", directory, source, identity), /ASSET_INVALID/u);
    await writeFile(join(directory, "core.wasm"), bytes); await writeFile(join(directory, "extra"), "unexpected");
    await assert.rejects(verifyCoreInput("core", directory, source, identity), /FILES_INVALID/u);
  } finally {await rm(directory, {recursive: true});}
});

for (const [coreId, files] of [["ppsspp", ["ppsspp-host.mjs", "ppsspp.worker.mjs"]], ["play", ["disc-device.mjs"]], ["mkxp", ["mkxp-z_libretro.js"]], ["kirikiri2", ["vlfs.js"]]]) {
test(`[PK-05] CONTRACT/core-contract-fingerprint-${coreId} [X-20] CONTRACT/core-contract-fingerprint-${coreId} rejects correctly hashed artifacts exporting an obsolete content contract`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "content-io-old-contract-"));
  const identity = {commit: "a".repeat(40), branch: "feat/content", dirty: true, sourceTreeSha256: "b".repeat(64)};
  const source = {repository: "https://github.com/retrom-project/ppsspp", adapterAbi: "ppsspp-host-v3",
    assets: files.map(filename => ({filename, maxSizeBytes: 1000}))};
  const old = Buffer.from(`export const contractSha256 = '${"c".repeat(64)}';`), current = "d".repeat(64);
  const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId, ...identity,
    repository: source.repository, adapterAbi: source.adapterAbi, files: source.assets.map(({filename}) => ({filename, sizeBytes: old.length, sha256: hash(old)}))};
  try {
    await writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify(descriptor));
    for (const {filename} of source.assets) await writeFile(join(directory, filename), old);
    await assert.rejects(verifyCoreInput(coreId, directory, source, identity, current), /CONTRACT_MISMATCH/u);
    const bytes = Buffer.from(`export const contractSha256 = '${current}';`);
    for (const file of descriptor.files) {await writeFile(join(directory, file.filename), bytes); file.sizeBytes = bytes.length; file.sha256 = hash(bytes);}
    await writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify(descriptor));
    assert.equal((await verifyCoreInput(coreId, directory, source, identity, current)).descriptor.coreId, coreId);
  } finally {await rm(directory, {recursive: true});}
});

}
