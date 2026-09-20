import {mkdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {randomUUID} from "node:crypto";
import {absolutePath, argumentsFor, atomicJSON, main, within} from "./cli.mjs";
import {coverage, hash, verifyResult} from "./evidence.mjs";
import {execute} from "./execute.mjs";
import {testCommand} from "./commands.mjs";
import {commandSummary, reportKinds, validateResult} from "./result-format.mjs";
import {proofAssertions} from "./report-locations.mjs";
import {addOutput, beginResult, captureCoreInputs, captureProviderInputs, sourceSnapshot, writeOutput} from "./result-build.mjs";
import {readPFB, runtimeRoot} from "./preflight.mjs";
import {captureArtifacts} from "./artifacts.mjs";
export {execute} from "./execute.mjs";
export {assertionsFrom} from "./reports.mjs";

async function runTest(spec, index, result, runRoot, environmentPath) {
  const reportPath = join(runRoot, `report-${index}.json`), logRoot = join(runRoot, `test-${index}`);
  const command = testCommand(spec.runner, spec.files, reportPath, runtimeRoot);
  command.env = {...command.env, CONTENT_IO_ENV: environmentPath, RETROM_CONTENT_IO_ENV: environmentPath, RETROM_CONTENT_IO_RUN_ROOT: runRoot};
  console.log(JSON.stringify(command));
  const record = await execute(command, logRoot, spec.timeoutMs ?? 300000);
  for (const [kind, path] of [["COMMAND", `${logRoot}.command.json`], ["STDOUT", record.stdoutPath], ["STDERR", record.stderrPath]]) await addOutput(result, path, kind);
  let report;
  try {report = await addOutput(result, reportPath, reportKinds[spec.runner]);} catch (error) {if (error.code !== "ENOENT") throw error;}
  result.commands.push(commandSummary(record, report ? reportPath : null, report ? hash(report) : null));
  if (record.exitCode !== 0 || record.timedOut || record.signal != null) throw new Error("CONTENT_IO_CHILD_FAILED");
  if (!report) throw new Error("CONTENT_IO_REPORT_MISSING");
  result.assertions.push(...proofAssertions(JSON.parse(report), spec.runner, reportPath));
}
export async function runStage() {
  const positional = process.argv.slice(2, 4);
  if (process.argv.includes("--help")) {console.log("stage run S00..S22 --env <absolute environment.json>"); return;}
  if (positional[0] !== "run" || !/^S(?:0\d|1\d|2[0-2])$/u.test(positional[1])) throw Object.assign(new Error("CONTENT_IO_STAGE_INVALID"), {exitCode: 2});
  const args = argumentsFor({env: {type: "string"}}, ["env"], process.argv.slice(4));
  const environmentBytes = await readFile(await absolutePath(args.env)), environment = JSON.parse(environmentBytes);
  const context = readPFB(environment.repositories.retrom.root, environment.pfb.name);
  if (JSON.stringify(context.pfb) !== JSON.stringify(environment.pfb)) throw new Error("CONTENT_IO_PFB_MISMATCH");
  const evidenceRoot = join(context.repositories.retrom.root, ".pfb/workspace/content-io");
  if (environment.paths.evidenceRoot !== evidenceRoot) throw new Error("CONTENT_IO_PATH_ESCAPE");
  const stages = JSON.parse(await readFile(new URL("../../tests/content-io/stages.json", import.meta.url), "utf8"));
  const stage = stages.find(entry => entry.id === positional[1]);
  let state = {}; const statePath = join(evidenceRoot, "implementation-state.json");
  try {state = JSON.parse(await readFile(statePath, "utf8"));} catch (error) {if (error.code !== "ENOENT") throw error;}
  for (const dependency of stage.dependencies) {
    if (!state[dependency]?.resultPath) throw new Error(`CONTENT_IO_DEPENDENCY_MISSING:${dependency}`);
    const path = await absolutePath(within(evidenceRoot, state[dependency].resultPath));
    await verifyResult(JSON.parse(await readFile(path, "utf8")), stages.find(item => item.id === dependency), runtimeRoot, dirname(path));
  }
  const runId = randomUUID(), runRoot = join(evidenceRoot, "runs", runId, stage.id);
  await mkdir(runRoot, {recursive: true});
  const {result, before} = await beginResult(context, stage, runtimeRoot, runId, runRoot, environmentBytes);
  state[stage.id] = {status: "IN_PROGRESS", resultPath: join(runRoot, "result.json")}; await atomicJSON(statePath, state);
  try {
    const cores = await captureCoreInputs(result, context, stage, runtimeRoot, runRoot);
    await captureProviderInputs(result, environment, stage, runtimeRoot, runRoot, cores);
    if (!stage.tests.length) throw new Error("CONTENT_IO_STAGE_NOT_IMPLEMENTED");
    for (const [index, spec] of stage.tests.entries()) await runTest(spec, index, result, runRoot, join(runRoot, "environment.json"));
    coverage(stage.required, result.assertions); result.status = "PASS";
  } catch (error) {
    result.blockingReasons.push({code: error.message, affectedStage: stage.id, evidence: null, nextPermittedAction: "Fix the failing stage and rerun into a new runId"});
  }
  const after = await sourceSnapshot(context, stage, runtimeRoot);
  await writeOutput(result, join(runRoot, "source-after.json"), "SOURCE_AFTER", after);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    result.status = "INVALIDATED";
    result.blockingReasons.push({code: "CONTENT_IO_INPUT_CHANGED", affectedStage: stage.id, evidence: join(runRoot, "source-after.json"), nextPermittedAction: "Freeze stage inputs and rerun"});
  }
  await writeOutput(result, join(runRoot, "assertions.json"), "ASSERTIONS", result.assertions);
  await captureArtifacts(result, runRoot);
  result.endedAt = new Date().toISOString(); validateResult(result);
  if (result.status === "PASS") {
    try {await verifyResult(result, stage, runtimeRoot, runRoot);} catch (error) {
      result.status = "FAIL"; result.blockingReasons.push({code: error.message, affectedStage: stage.id, evidence: null, nextPermittedAction: "Repair the machine evidence and rerun"});
    }
  }
  await atomicJSON(join(runRoot, "result.json"), result);
  state[stage.id].status = result.status; await atomicJSON(statePath, state);
  if (result.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({stage: stage.id, status: result.status, runRoot, blockingReasons: result.blockingReasons}));
}
main(import.meta.url, runStage);
