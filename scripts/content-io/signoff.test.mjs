import {test} from "node:test";
import assert from "node:assert/strict";
import {signoffCase} from "./signoff.mjs";
const stages = [
  {id: "S02", required: [{caseId: "IO-01", level: "CONTRACT", subcase: "schema"}]},
  {id: "S04", required: [{caseId: "IO-01", level: "UNIT", subcase: "strict-range"}]},
  {id: "S20", required: [{caseId: "IO-01", level: "PRODUCT", subcase: "actual-game"}]},
];
const results = () => stages.map(stage => ({stageId: stage.id, path: `/owned/${stage.id}/result.json`, sha256: "a".repeat(64),
  assertions: stage.required.map(row => ({...row, status: "passed"}))}));
test("[X-29] UNIT/signoff requires every owning level and subcase, preserving original proof locations", () => {
  const proofs = signoffCase("IO-01", results(), stages);
  assert.deepEqual(proofs.map(row => row.level), ["CONTRACT", "UNIT", "PRODUCT"]);
  assert.equal(proofs[2].resultPath, "/owned/S20/result.json"); assert.equal(proofs[2].assertion, 0);
});
for (const [name, mutate] of [
  ["missing stage", rows => rows.pop()], ["missing subcase", rows => {rows[1].assertions = [];}],
  ["wrong layer", rows => {rows[2].assertions[0].level = "UNIT";}],
  ["failed assertion", rows => {rows[0].assertions[0].status = "failed";}],
  ["prefix-only subcase", rows => {rows[1].assertions[0].subcase = "strict-range-not-run";}],
]) test(`[X-29] UNIT/signoff rejects ${name} even if other checks passed`, () => {
  const rows = results(); mutate(rows); assert.throws(() => signoffCase("IO-01", rows, stages), /SIGNOFF_CASE_MISSING/u);
});
test("[X-29] UNIT/signoff never invents ownership for an uncovered case", () => {
  assert.throws(() => signoffCase("IO-99", results(), stages), /SIGNOFF_CASE_UNOWNED/u);
});
