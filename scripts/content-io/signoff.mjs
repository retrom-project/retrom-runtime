import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {absolutePath, within} from "./cli.mjs";
import {verifyResult, hash} from "./evidence.mjs";

export async function priorResults(environment, stages, verify = verifyResult) {
  const root = environment.paths.evidenceRoot;
  const state = JSON.parse(await readFile(await absolutePath(join(root, "implementation-state.json")), "utf8"));
  const results = [];
  for (const stage of stages.filter(stage => stage.id < "S21")) {
    assert.equal(state[stage.id]?.status, "PASS", `CONTENT_IO_SIGNOFF_STAGE_MISSING:${stage.id}`);
    const path = await absolutePath(within(root, state[stage.id].resultPath));
    const bytes = await readFile(path), result = JSON.parse(bytes);
    await verify(result, stage, environment.repositories.runtime.root, dirname(path));
    results.push({stageId: stage.id, path, sha256: hash(bytes), assertions: result.assertions});
  }
  assert.equal(results.length, 21, "CONTENT_IO_SIGNOFF_STAGE_COUNT");
  return results;
}
export function signoffCase(caseId, results, stages) {
  const proofs = [];
  for (const stage of stages.filter(stage => stage.id < "S21")) {
    for (const required of stage.required.filter(row => row.caseId === caseId)) {
      const result = results.find(row => row.stageId === stage.id);
      const index = result?.assertions.findIndex(row => row.caseId === caseId && row.level === required.level &&
        row.subcase === required.subcase && row.status === "passed");
      assert.ok(index !== undefined && index >= 0, `CONTENT_IO_SIGNOFF_CASE_MISSING:${stage.id}:${caseId}`);
      proofs.push({stageId: stage.id, resultPath: result.path, sha256: result.sha256, assertion: index, ...required});
    }
  }
  assert.ok(proofs.length > 0, `CONTENT_IO_SIGNOFF_CASE_UNOWNED:${caseId}`);
  return proofs;
}
