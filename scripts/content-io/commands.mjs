import {basename, dirname, join} from "node:path";
export function testCommand(kind, files, report, cwd) {
  if (kind === "node") return {cwd, executable: process.execPath, args: ["--test", "--test-reporter=./scripts/content-io/report-node.mjs", `--test-reporter-destination=${report}`, ...files]};
  if (kind === "vitest") return {cwd, executable: process.execPath, args: ["node_modules/vitest/vitest.mjs", "run", ...files, "--reporter=json", `--outputFile=${report}`]};
  if (kind === "playwright") return {cwd, executable: process.execPath, args: ["node_modules/@playwright/test/cli.js", "test", "--config=tests/content-io/playwright.config.ts", "--project=protocol", "--reporter=json", `--output=${join(dirname(report), `${basename(report, ".json")}-browser`)}`, ...files], env: {PLAYWRIGHT_JSON_OUTPUT_NAME: report}};
  throw new Error(`CONTENT_IO_RUNNER_UNAVAILABLE:${kind}`);
}
