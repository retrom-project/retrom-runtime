import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, symlink, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {artifactDigest, artifactFiles, captureArtifacts} from "./artifacts.mjs";
import {testCommand} from "./commands.mjs";
import {proofFixture} from "./proof-fixture.mjs";
import {verifyResult} from "./evidence.mjs";
test("[X-29] UNIT/retained-artifacts hashes nested product commands, reports and captures without reading them all into memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-artifacts-"));
  try {
    await mkdir(join(root, "case")); await writeFile(join(root, "case/report.json"), '{"status":"PASS"}');
    await writeFile(join(root, "case/capture.png"), Uint8Array.of(1, 2, 3));
    await writeFile(join(root, "result.json"), "summary");
    const result = {outputs: []}; await captureArtifacts(result, root);
    assert.equal(result.outputs.length, 2); assert.ok(result.outputs.every(row => row.kind === "ARTIFACT"));
    const before = result.outputs.find(row => row.path.endsWith("capture.png"));
    await writeFile(before.path, Uint8Array.of(3, 2, 1));
    assert.notEqual((await artifactDigest(before.path)).sha256, before.sha256);
    await symlink(join(root, "case/report.json"), join(root, "alias"));
    await assert.rejects(artifactFiles(root), /EVIDENCE_PATH_INVALID/u);
  } finally {await rm(root, {recursive: true});}
});
test("[X-29] UNIT/retained-artifacts uses distinct Playwright output directories for each stage command", () => {
  const first = testCommand("playwright", ["owned.browser.ts"], "/owned/run/report-0.json", "/runtime");
  const second = testCommand("playwright", ["owned.browser.ts"], "/owned/run/report-1.json", "/runtime");
  assert.ok(first.args.includes("--output=/owned/run/report-0-browser"));
  assert.ok(second.args.includes("--output=/owned/run/report-1-browser"));
});
test("[X-29] UNIT/retained-artifacts rejects changed or omitted nested evidence even when the machine report still passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-nested-proof-"));
  try {
    const {stage, result, runRoot} = await proofFixture(root);
    const capture = join(runRoot, "scene.png"); await writeFile(capture, Uint8Array.of(1, 2, 3));
    await captureArtifacts(result, runRoot); await verifyResult(result, stage, root, runRoot);
    await writeFile(capture, Uint8Array.of(3, 2, 1));
    await assert.rejects(verifyResult(result, stage, root, runRoot), /EVIDENCE_TAMPERED/u);
    result.outputs = result.outputs.filter(row => row.path !== capture);
    await assert.rejects(verifyResult(result, stage, root, runRoot), /EVIDENCE_INVENTORY_MISMATCH/u);
  } finally {await rm(root, {recursive: true});}
});
