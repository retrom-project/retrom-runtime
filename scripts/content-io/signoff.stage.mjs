import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {absolutePath} from "./cli.mjs";
import {priorResults, signoffCase} from "./signoff.mjs";
const stages = JSON.parse(await readFile(new URL("../../tests/content-io/stages.json", import.meta.url), "utf8"));
let verified;
async function inputs() {
  const environment = JSON.parse(await readFile(await absolutePath(process.env.CONTENT_IO_ENV), "utf8"));
  return priorResults(environment, stages);
}
for (const required of stages.find(stage => stage.id === "S21").required.filter(row => row.subcase === "signoff")) {
  test(`[${required.caseId}] CONTRACT/signoff verifies every owning stage's original assertion and current source identities`, async context => {
    verified ??= inputs();
    context.diagnostic(JSON.stringify(signoffCase(required.caseId, await verified, stages)));
  });
}
