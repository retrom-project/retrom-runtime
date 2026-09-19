import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, symlink, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {argumentsFor, absolutePath, within} from "./cli.mjs";
import {outputPaths} from "./preflight.mjs";
import {scanText} from "./inventory.mjs";

test("[S00] UNIT/preflight-arguments", () => {
  assert.throws(() => argumentsFor({}, [], ["--unknown"]), {exitCode: 2});
  assert.throws(() => argumentsFor({env: {type: "string"}}, ["env"], []), {exitCode: 2});
  assert.equal(argumentsFor({}, ["env"], ["--help"]).help, true);
  assert.throws(() => within("/pfb/one", "/pfb/two/environment.json"), /PATH_ESCAPE/u);
  assert.throws(() => within("/pfb/one", "/pfb/one-more/environment.json"), /PATH_ESCAPE/u);
  assert.equal(within("/pfb/one", "/pfb/one/environment.json"), "/pfb/one/environment.json");
});
test("[S00] UNIT/preflight-realpath", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-preflight-"));
  try {
    await mkdir(join(root, "actual")); await symlink(join(root, "actual"), join(root, "alias"));
    await assert.rejects(() => absolutePath("relative"), {exitCode: 2});
    await assert.rejects(() => absolutePath(join(root, "alias")), /SYMLINK_PATH_REJECTED/u);
    assert.equal(await absolutePath(join(root, "actual")), join(root, "actual"));
  } finally {await rm(root, {recursive: true});}
});
test("[S00] UNIT/inventory-symbols", () => {
  const scan = scanText("fetch.ts", 'export async function load() { const r = await fetch("/game"); return r.arrayBuffer(); }');
  assert.equal(scan.declarations[0].symbol, "load"); assert.equal(scan.declarations[0].async, true);
  assert.deepEqual(scan.operations.map((call) => call.callee), ["fetch", "r.arrayBuffer"]);
});

test("[S00] UNIT/preflight-candidate-paths records explicit local outputs and refuses another PFB", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-io-candidate-paths-"));
  try {
    const candidates = join(root, ".pfb/candidates/window"), evidence = join(root, ".pfb/workspace/content-io");
    await mkdir(candidates, {recursive: true}); await mkdir(evidence, {recursive: true});
    const selected = {"candidate-root": join(candidates, "runtime"), "candidate-base-root": join(evidence, "window-base")};
    const paths = await outputPaths(root, selected);
    assert.equal(paths.runtimeCandidateOut, selected["candidate-root"]); assert.equal(paths.candidateRoot, paths.runtimeCandidateOut);
    assert.equal(paths.candidateBaseRoot, selected["candidate-base-root"]);
    await assert.rejects(() => outputPaths(root, {...selected, "candidate-root": join(tmpdir(), "other-candidate")}), /PATH_ESCAPE/u);
    await assert.rejects(() => outputPaths(root, {...selected, "candidate-base-root": join(tmpdir(), "other-base")}), /PATH_ESCAPE/u);
    await symlink(candidates, join(root, "alias"));
    await assert.rejects(() => outputPaths(root, {...selected, "candidate-root": join(root, "alias/runtime")}), /SYMLINK/u);
  } finally {await rm(root, {recursive: true});}
});
