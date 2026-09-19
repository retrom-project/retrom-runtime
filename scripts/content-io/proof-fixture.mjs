/** Synthetic records solely for negative validator tests, never acceptance evidence. */
import {mkdir, writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
import {inputDigest, hash} from "./evidence.mjs";
import {repositoryTrees} from "./repository-tree.mjs";
import {testCommand} from "./commands.mjs";
import {commandSummary} from "./result-format.mjs";
import {proofAssertions} from "./report-locations.mjs";
export async function proofFixture(root) {
  execFileSync("git", ["init", "--quiet", root]); await mkdir(join(root, "src"));
  await writeFile(join(root, "src/input.ts"), "input");
  await writeFile(join(root, ".gitignore"), "/*.json\n/*.log\n/*.json.real\n/evidence/\n");
  execFileSync("git", ["-C", root, "add", "src"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "validator fixture"]);
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  const environment = {repositories: {runtime: {root}, cores: {}}};
  const stage = {id: "S01", inputs: ["src"], tests: [{runner: "node", files: ["src/input.ts"]}], required: [{caseId: "IO-01", subcase: "registration", level: "UNIT"}]};
  const runRoot = join(root, "evidence"); await mkdir(runRoot);
  const reportPath = join(runRoot, "report-0.json"), report = {assertions: [{name: "[IO-01] UNIT/registration", status: "passed"}]};
  const before = {repositoryHeads: {runtime: head}, repositoryTrees: await repositoryTrees(environment.repositories), stageInputSha256: await inputDigest(root, stage.inputs)};
  const raw = {...testCommand("node", stage.tests[0].files, reportPath, root), exitCode: 0, signal: null, timedOut: false,
    stdoutPath: join(runRoot, "test-0.stdout.log"), stderrPath: join(runRoot, "test-0.stderr.log")};
  const result = {schemaVersion: 1, runId: randomUUID(), stageId: "S01", status: "PASS", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
    inputs: {repositoryHeads: before.repositoryHeads, sourceTreeDigests: {...before.repositoryTrees, stageInputs: before.stageInputSha256}, environmentDigest: hash(JSON.stringify(environment)), contractSha256: null, providerIdentities: [], coreIdentities: []},
    commands: [commandSummary(raw, reportPath, hash(JSON.stringify(report)))], assertions: proofAssertions(report, "node", reportPath), metricsPath: null, outputs: [], blockingReasons: []};
  const add = async (name, kind, bytes) => {
    const path = join(runRoot, name); await writeFile(path, bytes);
    result.outputs.push({path, kind, sizeBytes: Buffer.byteLength(bytes), sha256: hash(bytes)});
  };
  for (const [name, kind, value] of [["environment.json", "ENVIRONMENT", environment], ["source-before.json", "SOURCE_BEFORE", before], ["source-after.json", "SOURCE_AFTER", before],
    ["report-0.json", "NODE_REPORT", report], ["test-0.command.json", "COMMAND", raw], ["assertions.json", "ASSERTIONS", result.assertions]]) await add(name, kind, JSON.stringify(value));
  await add("test-0.stdout.log", "STDOUT", ""); await add("test-0.stderr.log", "STDERR", "");
  return {stage, result, runRoot};
}
export async function replaceProofArtifact(result, kind, mutate) {
  const {readFile} = await import("node:fs/promises");
  const artifact = result.outputs.find(item => item.kind === kind), value = JSON.parse(await readFile(artifact.path, "utf8"));
  mutate(value); const bytes = JSON.stringify(value); await writeFile(artifact.path, bytes);
  artifact.sha256 = hash(bytes); artifact.sizeBytes = Buffer.byteLength(bytes); return value;
}
