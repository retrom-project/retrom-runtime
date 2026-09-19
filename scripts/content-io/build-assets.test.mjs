import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildContentAssets, verifyGraph} from "./build-assets.mjs";
import {contractHash} from "./contract.mjs";
import {hash} from "./evidence.mjs";
test("[PK-04] CONTRACT/asset-build builds deterministic, self-contained workers with exact current digests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "content-assets-"));
  try {
    const first = await buildContentAssets(join(directory, "first")), second = await buildContentAssets(join(directory, "second"));
    assert.deepEqual(first, second); assert.equal(first.contractSha256, await contractHash());
    assert.deepEqual(first.files.map(file => file.path), ["assets/content-io/worker.mjs", "assets/content-io/sync-client.mjs"]);
    for (const file of first.files) {
      const bytes = await readFile(join(directory, "first", file.path.split("/").at(-1)));
      assert.equal(bytes.length, file.sizeBytes); assert.equal(hash(bytes), file.sha256);
      assert.ok(bytes.includes(Buffer.from(first.contractSha256)));
    }
  } finally {await rm(directory, {recursive: true});}
});
test("[PK-06] CONTRACT/sync-graph rejects external code loading and private sync transport dependencies", () => {
  const graph = {inputs: {}, outputs: {"worker.mjs": {imports: []}}};
  for (const source of ['import("./extra.mjs")', 'import value from "./extra.mjs"', 'export * from "./extra.mjs"', 'require("extra")']) {
    assert.throws(() => verifyGraph("worker", graph, source), /ASSET_EXTERNAL_IMPORT/u);
  }
  assert.throws(() => verifyGraph("worker", {inputs: {}, outputs: {worker: {imports: [{path: "extra"}]}}}, ""), /ASSET_EXTERNAL_IMPORT/u);
  for (const path of ["src/content-io/http.ts", "src/content-io/store/opfs.ts"]) {
    assert.throws(() => verifyGraph("sync-client", {...graph, inputs: {[path]: {}}}, ""), /SYNC_DEPENDENCY_INVALID/u);
  }
  verifyGraph("sync-client", {...graph, inputs: {"src/content-io/lru.ts": {}}}, "export const ok=1;");
});
