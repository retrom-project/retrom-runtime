import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, symlink, rename} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyResult} from "./evidence.mjs";
import {proofFixture, replaceProofArtifact} from "./proof-fixture.mjs";
for (const corruption of ["copied-assertions", "failed-command", "missing-command", "wrong-command", "missing-report", "wrong-runner", "report-location", "environment",
  "source-after", "no-logs", "timeout-with-exit-zero", "unknown-field", "outside-root", "symlink", "missing-run-id", "reported-sha"]) {
  test(`[X-29] UNIT/evidence-${corruption} cross-checks original reports, provenance and command results`, async () => {
    const root = await mkdtemp(join(tmpdir(), "content-io-proof-"));
    try {
      const {stage, result, runRoot} = await proofFixture(root); await verifyResult(result, stage, root, runRoot);
      if (corruption === "copied-assertions") await replaceProofArtifact(result, "NODE_REPORT", report => {report.assertions = [{name: "unrelated passing test", status: "passed"}];});
      else if (corruption === "failed-command") result.commands[0].exitCode = 9;
      else if (corruption === "missing-command") result.commands = [];
      else if (corruption === "wrong-command") result.commands[0].args = ["--version"];
      else if (corruption === "missing-report") result.outputs = result.outputs.filter(item => item.kind !== "NODE_REPORT");
      else if (corruption === "wrong-runner") result.outputs.find(item => item.kind === "NODE_REPORT").kind = "VITEST_REPORT";
      else if (corruption === "report-location") result.assertions[0].reportLocation = "/assertions/999";
      else if (corruption === "environment") result.inputs.environmentDigest = "f".repeat(64);
      else if (corruption === "source-after") await replaceProofArtifact(result, "SOURCE_AFTER", value => {value.stageInputSha256 = "f".repeat(64);});
      else if (corruption === "no-logs") result.outputs = result.outputs.filter(item => item.kind !== "STDERR");
      else if (corruption === "timeout-with-exit-zero") await replaceProofArtifact(result, "COMMAND", value => {value.timedOut = true;});
      else if (corruption === "unknown-field") result.override = "PASS";
      else if (corruption === "outside-root") result.outputs[0].path = join(tmpdir(), "outside-environment.json");
      else if (corruption === "missing-run-id") delete result.runId;
      else if (corruption === "reported-sha") result.commands[0].reportSha256 = "f".repeat(64);
      else {
        const artifact = result.outputs.find(item => item.kind === "NODE_REPORT");
        await rename(artifact.path, artifact.path + ".real"); await symlink(artifact.path + ".real", artifact.path);
      }
      await assert.rejects(() => verifyResult(result, stage, root, runRoot), /CONTENT_IO_/u);
    } finally {await rm(root, {recursive: true});}
  });
}
