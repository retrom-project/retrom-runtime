import {strict as assert} from "node:assert";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";

test("quality rejects failed, cancelled or skipped checks and browser suites", async () => {
  const workflow = await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  assert.match(workflow, /needs: \[checks, content_io_browser\]/u);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/u);
  const command = workflow.match(/run: (test "\$CHECKS_RESULT"[^\n]+)/u)?.[1];
  assert.ok(command);
  const run = (checks, browser) => spawnSync("bash", ["-e", "-c", command],
    {env: {...process.env, CHECKS_RESULT: checks, BROWSER_RESULT: browser}}).status;
  assert.equal(run("success", "success"), 0);
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    assert.notEqual(run(result, "success"), 0);
    assert.notEqual(run("success", result), 0);
  }
});

test("PR and release run the same checks and public browser command", async () => {
  const quality = await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  const release = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  for (const workflow of [quality, release]) {
    for (const command of ["npm run ci:checks", "npm run test:content-io:ci", "npm run package:check"]) {
      assert.ok(workflow.includes(`run: ${command}`), command);
    }
  }
  assert.ok(release.indexOf("run: npm run package:check") < release.indexOf("name: Publish GitHub Release"));
});
