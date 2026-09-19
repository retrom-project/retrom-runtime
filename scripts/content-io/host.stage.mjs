import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile, realpath} from "node:fs/promises";
import {join} from "node:path";
import {absolutePath, within} from "./cli.mjs";
import {execute} from "./execute.mjs";
test("[HP-01] UNIT/host-routes [HP-02] UNIT/host-observers [HP-03] UNIT/host-observers [HP-04] UNIT/host-observers [HP-05] UNIT/host-catalog [HP-06] UNIT/host-catalog [HP-07] UNIT/host-observers executes the Host protocol, observer, product-contract and web suites", async context => {
  const environmentPath = await absolutePath(process.env.CONTENT_IO_ENV);
  const environment = JSON.parse(await readFile(environmentPath, "utf8"));
  const runRoot = await absolutePath(within(environment.paths.evidenceRoot, process.env.RETROM_CONTENT_IO_RUN_ROOT));
  const directory = join(runRoot, "host-check");
  const command = {cwd: environment.repositories.retrom.root, executable: await realpath(environment.tools.python.path),
    args: ["-m", "scripts.acceptance.content_io_host_check", "--env", environmentPath, "--output", directory]};
  const record = await execute(command, join(runRoot, "host-command"), 900000);
  context.diagnostic(JSON.stringify(record));
  assert.equal(record.exitCode, 0); assert.equal(record.timedOut, false); assert.equal(record.signal, null);
  const report = JSON.parse(await readFile(join(directory, "host-check.json"), "utf8"));
  assert.equal(report.status, "PASS"); assert.equal(report.commands.length, 4);
  for (const [index, child] of report.commands.entries()) {
    assert.equal(child.exitCode, 0); assert.equal(child.timedOut, false);
    const stdout = await readFile(join(directory, `${index}.stdout.log`), "utf8");
    const stderr = await readFile(join(directory, `${index}.stderr.log`), "utf8");
    assert.ok(stdout.length + stderr.length > 0); context.diagnostic(JSON.stringify({command: child, stdout, stderr}));
  }
});
