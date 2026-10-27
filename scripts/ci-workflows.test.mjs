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

test("PR runs source checks and public browser tests before release tagging", async () => {
  const quality = await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  for (const command of ["npm run ci:checks", "npm run test:content-io:ci", "npm run package:check"]) {
    assert.ok(quality.includes(`run: ${command}`), command);
  }
});

test("release validates identity and artifacts without repeating PR source checks", async () => {
  const release = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  for (const command of ["npm run ci:checks", "npm run lint", "npm run typecheck", "npm test",
    "npm run test:scripts", "npm run docs:platforms:check", "npm run test:content-io:ci", "npx playwright"]) {
    assert.ok(!release.includes(`run: ${command}`), command);
  }
  assert.ok(release.includes("name: Validate release identity"));
  assert.ok(release.includes("RETROM_PROVIDER_BUILD_MODE: release"));
  assert.ok(release.indexOf("run: npm run release:build") >= 0);
  assert.ok(release.indexOf("run: npm run release:build") < release.indexOf("run: npm run package:check"));
  assert.ok(release.includes("run: npm run package:check"));
  assert.ok(release.indexOf("run: npm run package:check") < release.indexOf("name: Publish GitHub Release"));
});
