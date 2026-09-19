import {setTimeout, clearTimeout} from "node:timers";
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {coverage, verifyResult} from "./evidence.mjs";
import {proofFixture} from "./proof-fixture.mjs";
import {execute, assertionsFrom} from "./stage.mjs";
const requirement = {caseId: "IO-01", subcase: "registration", level: "UNIT"};
test("[S01] UNIT/runner-coverage [X-29] UNIT/stage-S01", () => {
  const assertions = [{name: "[IO-01] UNIT/registration", status: "passed"}];
  coverage([requirement], assertions);
  assert.throws(() => coverage([requirement], []), /ZERO_ASSERTIONS/u);
  assert.throws(() => coverage([{...requirement, level: "PRODUCT"}], assertions), /CASE_MISSING/u);
  assert.throws(() => coverage([{...requirement, subcase: "missing"}], assertions), /CASE_MISSING/u);
  assert.throws(() => coverage([requirement], [{...assertions[0], status: "skipped"}]), /CASE_MISSING/u);
  assert.throws(() => assertionsFrom({}, "vitest"), /MACHINE_REPORT_INVALID/u);
});
test("[S01] UNIT/runner-child-failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-runner-"));
  try {
    const result = await execute({cwd: root, executable: process.execPath, args: ["-e", "process.exit(9)"]}, join(root, "failed"));
    assert.equal(result.exitCode, 9);
    const missing = await execute({cwd: root, executable: join(root, "absent"), args: []}, join(root, "missing"));
    assert.equal(missing.exitCode, null);
  } finally {await rm(root, {recursive: true});}
});
test("[S01] UNIT/runner-stale-and-tampered", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-evidence-"));
  try {
    const {stage, result, runRoot} = await proofFixture(root);
    await verifyResult(result, stage, root, runRoot);
    await writeFile(join(runRoot, "report-0.json"), "tamper");
    await assert.rejects(() => verifyResult(result, stage, root, runRoot), /TAMPERED/u);
    await writeFile(join(root, "src/input.ts"), "after");
    await assert.rejects(() => verifyResult(result, stage, root, runRoot), /STALE/u);
  } finally {await rm(root, {recursive: true});}
});


test("[X-29] UNIT/exact-subcase rejects a similarly prefixed assertion", () => {
  assert.throws(() => coverage([requirement], [{name: "[IO-01] UNIT/registration-ignored", status: "passed"}]), /CASE_MISSING/u);
});
test("[S01] UNIT/hard-timeout terminates a child that ignores graceful shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-timeout-"));
  let cleanup;
  try {
    const log = join(root, "hung");
    const started = Date.now();
    // Cleanup also makes the old, broken runner's red test terminate deterministically.
    cleanup = setTimeout(async () => {
      const pid = Number((await readFile(log + ".stdout.log", "utf8")).trim());
      try {process.kill(pid, "SIGKILL");} catch (error) {if (error.code !== "ESRCH") throw error;}
    }, 1800);
    const result = await execute({cwd: root, executable: process.execPath,
      args: ["-e", "process.on('SIGTERM',()=>{}); console.log(process.pid); setInterval(()=>{},1000)"]}, log, 300);
    assert.ok(Date.now() - started < 1500, "runner did not enforce its hard timeout");
    assert.equal(result.timedOut, true); assert.equal(result.signal, "SIGKILL");
  } finally {clearTimeout(cleanup); await rm(root, {recursive: true});}
});
