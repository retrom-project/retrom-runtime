import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {absolutePath, argumentsFor, main} from "./cli.mjs";
import {runtimeRoot} from "./preflight.mjs";
export async function browser() {
  const args = argumentsFor({stage: {type: "string"}, env: {type: "string"}}, ["stage", "env"]);
  if (args.help) {console.log("browser --stage Sxx --env <absolute environment.json>"); return;}
  if (!/^S(?:0\d|1\d|2[0-2])$/u.test(args.stage)) {throw Object.assign(new Error("CONTENT_IO_STAGE_INVALID"), {exitCode: 2});}
  const environment = JSON.parse(await readFile(await absolutePath(args.env), "utf8"));
  if (args.stage === "S20" && !environment.tools.chrome) {throw new Error("CONTENT_IO_BROWSER_UNAVAILABLE");}
  const result = spawnSync(process.execPath, [join(runtimeRoot, "node_modules/@playwright/test/cli.js"), "test",
    "--config=tests/content-io/playwright.config.ts", `--project=${args.stage === "S20" ? "product" : "protocol"}`, `--grep=@${args.stage}`],
  {cwd: runtimeRoot, stdio: "inherit", env: {...process.env, CONTENT_IO_ENV: args.env, RETROM_CONTENT_IO_ENV: args.env, RETROM_CHROME_EXECUTABLE: environment.tools.chrome?.path ?? ""}});
  if (result.status !== 0) {throw new Error("CONTENT_IO_BROWSER_FAILED");}
}
main(import.meta.url, browser);
