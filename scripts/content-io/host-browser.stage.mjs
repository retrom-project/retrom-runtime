import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {absolutePath, within} from "./cli.mjs";
import {execute} from "./execute.mjs";
test("[HP-03] BROWSER/host-metrics executes the real Chrome iframe removal and final diagnostic retention check", async context => {
  const environment = JSON.parse(await readFile(await absolutePath(process.env.CONTENT_IO_ENV), "utf8"));
  assert.ok(environment.tools.chrome?.path, "CONTENT_IO_CHROME_REQUIRED");
  const output = await absolutePath(within(environment.paths.evidenceRoot, process.env.RETROM_CONTENT_IO_RUN_ROOT));
  const record = await execute({cwd: environment.repositories.retrom.root, executable: process.execPath,
    args: ["--test", "scripts/acceptance/content_io_metrics_browser.mjs"],
    env: {NODE_TEST_CONTEXT: undefined, RETROM_CHROME_EXECUTABLE: environment.tools.chrome.path}}, join(output, "host-browser"), 45000);
  context.diagnostic(JSON.stringify(record));
  for (const path of [record.stdoutPath, record.stderrPath]) context.diagnostic(await readFile(path, "utf8"));
  assert.equal(record.exitCode, 0); assert.equal(record.timedOut, false); assert.equal(record.signal, null);
});
