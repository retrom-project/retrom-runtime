import test from "node:test";
import assert from "node:assert/strict";
import {selectEvidenceStages} from "./evidence.mjs";
const stages = Array.from({length: 23}, (_, index) => ({id: `S${String(index).padStart(2, "0")}`}));
test("[X-29] UNIT/evidence-scope keeps candidate signoff separate from the authorized release gate", () => {
  assert.equal(selectEvidenceStages(stages, {candidate: true}).length, 22);
  assert.equal(selectEvidenceStages(stages, {all: true}).length, 23);
  assert.deepEqual(selectEvidenceStages(stages, {stage: "S22"}), [{id: "S22"}]);
  for (const input of [{}, {candidate: true, all: true}, {candidate: true, stage: "S20"}, {stage: "S23"}]) {
    assert.throws(() => selectEvidenceStages(stages, input), /STAGE_INVALID/u);
  }
});
