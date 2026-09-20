import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {hash} from "./evidence.mjs";
import {readPFB} from "./preflight.mjs";

const environment = JSON.parse(await readFile(process.env.CONTENT_IO_ENV, "utf8"));
test("[S00] UNIT/baseline-gates-and-golden", async () => {
  const baseline = JSON.parse(await readFile(join(environment.paths.evidenceRoot, "baseline.json"), "utf8"));
  assert.equal(baseline.gates.length, 7);
  for (const gate of baseline.gates) {assert.equal(gate.exitCode, 0); assert.ok(gate.containerCommand.includes("--user"));}
  for (const artifact of baseline.artifacts) {assert.equal(hash(await readFile(artifact.path)), artifact.sha256);}
  assert.deepEqual(baseline.manifests.map((manifest) => manifest.providerId).sort(), ["emulatorjs", "retrom-runtime"]);
  assert.ok(baseline.manifests.every((manifest) => manifest.targets.length > 0));
  const inventory = JSON.parse(await readFile(join(environment.paths.evidenceRoot, "entrypoints.json"), "utf8"));
  assert.equal(inventory.entries.filter((entry) => entry.mode === "RANGE").length, 6);
  assert.ok(inventory.entries.every((entry) => entry.sourceSha256 && entry.symbol && entry.roles.length));
});
test("[S00] UNIT/preflight-repeat-and-pfb-boundary", () => {
  const first = readPFB(environment.repositories.retrom.root, environment.pfb.name);
  const second = readPFB(environment.repositories.retrom.root, environment.pfb.name);
  assert.deepEqual(first, second);
  assert.equal(first.pfb.id, environment.pfb.id);
  for (const core of Object.values(first.repositories.cores)) {
    assert.equal(typeof core.dirty, "boolean"); assert.match(core.sourceTreeSha256, /^[a-f0-9]{64}$/u);
  }
  assert.throws(() => readPFB(environment.repositories.retrom.root, "another-pfb"));
  assert.throws(() => readPFB(environment.repositories.retrom.root.replace("/.worktree/content-io", ""), environment.pfb.name));
});
