import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile, realpath} from "node:fs/promises";
import {join} from "node:path";
import {absolutePath, within} from "./cli.mjs";
import {execute} from "./execute.mjs";

const stages = JSON.parse(await readFile(new URL("../../tests/content-io/stages.json", import.meta.url), "utf8"));
const labels = stages.find(stage => stage.id === "S20").required.map(row => `[${row.caseId}] ${row.level}/${row.subcase}`).join(" ");
test(`${labels} executes all 21 real Host cases with current identities, complete scenarios and measured performance`, async context => {
  const environmentPath = await absolutePath(process.env.CONTENT_IO_ENV);
  const environment = JSON.parse(await readFile(environmentPath, "utf8"));
  const runRoot = await absolutePath(within(environment.paths.evidenceRoot, process.env.RETROM_CONTENT_IO_RUN_ROOT));
  const directory = join(runRoot, "products");
  const record = await execute({cwd: environment.repositories.retrom.root, executable: await realpath(environment.tools.python.path),
    args: ["-m", "scripts.acceptance.content_io_product_check", "--env", environmentPath, "--output", directory]}, join(runRoot, "product-command"), 12600000);
  context.diagnostic(JSON.stringify(record));
  for (const path of [record.stdoutPath, record.stderrPath]) context.diagnostic(await readFile(path, "utf8"));
  assert.equal(record.exitCode, 0); assert.equal(record.timedOut, false); assert.equal(record.signal, null);
  const report = JSON.parse(await readFile(join(directory, "product-check.json"), "utf8"));
  assert.equal(report.status, "PASS"); assert.equal(report.cases.length, 21);
  assert.equal(new Set(report.cases.map(row => row.caseId)).size, 21);
  context.diagnostic(JSON.stringify(report));
  for (const row of report.cases) {
    assert.equal(row.status, "PASS"); assert.equal(row.exitCode, 0); assert.equal(row.timedOut, false); assert.equal(row.inputUnchanged, true);
    const proof = JSON.parse(await readFile(join(directory, row.caseId, "validation.log"), "utf8"));
    assert.equal(proof.status, "PASS"); assert.equal(proof.caseId, row.caseId); context.diagnostic(JSON.stringify(proof));
  }
});
