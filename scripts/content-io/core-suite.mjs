import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile, readdir, realpath} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {absolutePath, within} from "./cli.mjs";
import {currentCoreIdentities} from "./core-identities.mjs";
import {runtimeRoot} from "./preflight.mjs";
const stages = {ppsspp: "S12", play: "S13", mkxp: "S14", kirikiri2: "S15"};
async function environment() {
  const path = process.env.CONTENT_IO_ENV ?? process.env.RETROM_CONTENT_IO_ENV;
  if (!path) throw new Error("CONTENT_IO_ENV_REQUIRED");
  return JSON.parse(await readFile(await absolutePath(path), "utf8"));
}
async function nodeTests(root, directory) {
  const files = (await readdir(join(root, directory))).filter(file => file.endsWith(".test.mjs")).sort();
  assert.ok(files.length, "CONTENT_IO_CORE_TESTS_MISSING");
  return ["--experimental-vm-modules", "--test", `--test-reporter=${fileURLToPath(new URL("report-node.mjs", import.meta.url))}`, ...files.map(file => join(directory, file))];
}
export function execute(executable, args, cwd, context) {
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(executable, args, {cwd, env, encoding: "utf8", timeout: 180000, maxBuffer: 8388608});
  context.diagnostic(JSON.stringify({cwd, executable, args, exitCode: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr}));
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
  return result;
}
export function defineCoreSuite(id, caseId) {
  test(`[PK-04] CONTRACT/core-${id} matches the current PFB source, compiled contract and exact artifact inventory`, async () => {
    const rows = await currentCoreIdentities(await environment(), stages[id], runtimeRoot);
    assert.equal(rows.length, 1); assert.equal(rows[0].id, id);
  });
  test(`[${caseId}] UNIT/${id}-fork-protocol executes the fork-owned protocol and lifecycle suite`, async context => {
    const env = await environment(), root = await realpath(env.repositories.cores[id].root);
    within(await realpath(env.pfb.projectRoot), root);
    if (id === "ppsspp" || id === "play") {
      const args = await nodeTests(root, id === "ppsspp" ? "libretro/retrom/tests" : "js/retrom");
      const result = execute(process.execPath, args, root, context), report = JSON.parse(result.stdout);
      assert.ok(report.assertions.length > 0); assert.ok(report.assertions.every(row => row.status === "passed"));
    } else if (id === "kirikiri2") {
      assert.match(execute(process.execPath, [".github/rpg-runtime/test-vlfs.mjs"], root, context).stdout, /test-vlfs: PASS/u);
    } else {
      execute(await realpath(env.tools.python.path), [".github/rpg-runtime/test-content-contract.py"], root, context);
      execute(process.execPath, [".github/rpg-runtime/test-remote-content.mjs", ".github/rpg-runtime/content-io/libwasmfs_content.js"], root, context);
    }
  });
}
