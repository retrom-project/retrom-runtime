import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile, realpath} from "node:fs/promises";
import {join} from "node:path";
import {absolutePath, within} from "./cli.mjs";
import {execute} from "./execute.mjs";
import {runtimeRoot} from "./preflight.mjs";

test("[PK-06] CONTRACT/runtime-quality executes the complete current lint, types, tests, build and package gates", async context => {
  const environment = JSON.parse(await readFile(await absolutePath(process.env.CONTENT_IO_ENV), "utf8"));
  const output = await absolutePath(within(environment.paths.evidenceRoot, process.env.RETROM_CONTENT_IO_RUN_ROOT));
  // Exact script equivalents use this process's verified Node, without relying on host .bin symlinks.
  const scripts = [
    ["node_modules/eslint/bin/eslint.js", "src", "scripts", "tests", "--max-warnings=0"],
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"],
    ["node_modules/vitest/vitest.mjs", "run"], ["scripts/clean.mjs"],
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], ["scripts/package-check.mjs"],
  ];
  for (const [index, args] of scripts.entries()) {
    const record = await execute({cwd: runtimeRoot, executable: process.execPath, args, env: {NODE_TEST_CONTEXT: undefined}}, join(output, `quality-${index}`));
    context.diagnostic(JSON.stringify(record));
    context.diagnostic(await readFile(record.stdoutPath, "utf8")); context.diagnostic(await readFile(record.stderrPath, "utf8"));
    assert.equal(record.exitCode, 0); assert.equal(record.signal, null); assert.equal(record.timedOut, false);
  }
});

test("[HP-01] CONTRACT/host-quality executes current Host structure, backend, integration and isolated web build gates", async context => {
  const environmentPath = await absolutePath(process.env.CONTENT_IO_ENV);
  const environment = JSON.parse(await readFile(environmentPath, "utf8"));
  const output = await absolutePath(within(environment.paths.evidenceRoot, process.env.RETROM_CONTENT_IO_RUN_ROOT));
  const record = await execute({cwd: environment.repositories.retrom.root, executable: await realpath(environment.tools.python.path),
    args: ["-m", "scripts.acceptance.content_io_host_check", "--quality", "--env", environmentPath, "--output", join(output, "host-quality")]},
  join(output, "host-quality-command"), 900000);
  context.diagnostic(JSON.stringify(record));
  assert.equal(record.exitCode, 0); assert.equal(record.signal, null); assert.equal(record.timedOut, false);
  const report = JSON.parse(await readFile(join(output, "host-quality/host-check.json"), "utf8"));
  assert.equal(report.status, "PASS"); assert.equal(report.commands.length, 1);
  context.diagnostic(JSON.stringify(report));
  for (const file of ["0.stdout.log", "0.stderr.log"]) context.diagnostic(await readFile(join(output, "host-quality", file), "utf8"));
});
