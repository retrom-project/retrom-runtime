import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {execute} from "./core-suite.mjs";
test("[S01] UNIT/fork-runner executes nested Node suites and preserves their reports", async context => {
  const root = await mkdtemp(join(tmpdir(), "content-fork-test-"));
  try {
    await writeFile(join(root, "test.mjs"), 'import {test} from "node:test";test("executed",()=>{});');
    const reporter = fileURLToPath(new URL("report-node.mjs", import.meta.url));
    const result = execute(process.execPath, ["--test", `--test-reporter=${reporter}`, "test.mjs"], root, context);
    assert.deepEqual(JSON.parse(result.stdout).assertions, [{name: "executed", status: "passed"}]);
  } finally {await rm(root, {recursive: true});}
});
