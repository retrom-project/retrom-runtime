import {test} from "node:test";
import assert from "node:assert/strict";
import {matchCoreIdentities, stageCoreIds} from "./core-identities.mjs";
test("[PK-04] CONTRACT/core-proof requires the exact core descriptor set and rejects stale or missing artifact identities", () => {
  assert.deepEqual(stageCoreIds("S12"), ["ppsspp"]); assert.deepEqual(stageCoreIds("S13"), ["play"]);
  assert.deepEqual(stageCoreIds("S14"), ["mkxp"]); assert.deepEqual(stageCoreIds("S15"), ["kirikiri2"]);
  assert.equal(stageCoreIds("S18").length, 4); assert.deepEqual(stageCoreIds("S09"), []);
  const rows = [{id: "ppsspp", descriptorSha256: "a".repeat(64), descriptor: {files: [{filename: "core.wasm", sha256: "b".repeat(64)}]}}];
  const path = "/proof/core-identities.json", identities = [{id: "ppsspp", sha256: rows[0].descriptorSha256, evidencePath: path, reportLocation: "/0/descriptorSha256"}];
  matchCoreIdentities(rows, globalThis.structuredClone(rows), identities, path);
  for (const recorded of [[], [{...rows[0], descriptorSha256: "c".repeat(64)}], [{...rows[0], descriptor: {files: []}}]]) {
    assert.throws(() => matchCoreIdentities(rows, recorded, identities, path), /CORE_IDENTITY_PROOF_INVALID/u);
  }
  for (const wrong of [[], [{...identities[0], id: "play"}], [{...identities[0], evidencePath: "/different"}]]) {
    assert.throws(() => matchCoreIdentities(rows, rows, wrong, path), /CORE_IDENTITY_PROOF_INVALID/u);
  }
});
