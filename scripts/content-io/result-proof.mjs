import {currentProviderIdentities, matchProviderIdentities, needsProviderIdentity} from "./provider-identities.mjs";
import {currentCoreIdentities, matchCoreIdentities, stageCoreIds} from "./core-identities.mjs";
import {readFile, lstat, realpath} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {within} from "./cli.mjs";
import {validateResult, requireProof, reportKinds, commandSummary} from "./result-format.mjs";
import {proofAssertions} from "./report-locations.mjs";
import {repositoryRoots, repositoryTrees} from "./repository-tree.mjs";
import {testCommand} from "./commands.mjs";
import {artifactDigest, artifactFiles} from "./artifacts.mjs";
export async function verifyProof(result, stage, root, runRoot, hash, currentDigest) {
  validateResult(result);
  requireProof(result.status === "PASS" && result.stageId === stage.id && result.inputs.sourceTreeDigests.stageInputs === currentDigest, "EVIDENCE_STALE");
  requireProof(typeof runRoot === "string" && await realpath(runRoot) === runRoot, "EVIDENCE_ROOT_INVALID");
  const files = new Map();
  const actualFiles = (await artifactFiles(runRoot)).filter(path => path !== join(runRoot, "result.json"));
  requireProof(JSON.stringify(actualFiles) === JSON.stringify(result.outputs.map(output => output.path).sort()), "EVIDENCE_INVENTORY_MISMATCH");
  for (const artifact of result.outputs) {
    within(runRoot, artifact.path);
    if (artifact.kind === "ARTIFACT") {
      requireProof(JSON.stringify(await artifactDigest(artifact.path)) === JSON.stringify(artifact), "EVIDENCE_TAMPERED");
      files.set(artifact.path, {artifact, bytes: null}); continue;
    }
    const stat = await lstat(artifact.path);
    requireProof(stat.isFile() && !stat.isSymbolicLink() && await realpath(artifact.path) === artifact.path, "EVIDENCE_PATH_INVALID");
    const bytes = await readFile(artifact.path);
    requireProof(bytes.length === artifact.sizeBytes && hash(bytes) === artifact.sha256, "EVIDENCE_TAMPERED");
    files.set(artifact.path, {artifact, bytes});
  }
  const only = kind => {
    const matches = [...files.values()].filter(item => item.artifact.kind === kind);
    requireProof(matches.length === 1, "EVIDENCE_PROVENANCE_MISSING"); return matches[0];
  };
  const environment = only("ENVIRONMENT");
  requireProof(hash(environment.bytes) === result.inputs.environmentDigest, "ENVIRONMENT_MISMATCH");
  const definition = JSON.parse(environment.bytes), repositories = definition.repositories;
  requireProof(repositories?.runtime?.root === root, "ENVIRONMENT_MISMATCH");
  const roots = repositoryRoots(repositories);
  requireProof(JSON.stringify(Object.keys(roots).sort()) === JSON.stringify(Object.keys(result.inputs.repositoryHeads).sort()), "REPOSITORY_MISSING");
  for (const [id, head] of Object.entries(result.inputs.repositoryHeads)) {
    requireProof(typeof roots[id]?.root === "string", "REPOSITORY_MISSING");
    requireProof(execFileSync("git", ["-C", roots[id].root, "rev-parse", "HEAD"], {encoding: "utf8"}).trim() === head, "EVIDENCE_STALE");
  }
  const before = JSON.parse(only("SOURCE_BEFORE").bytes), after = JSON.parse(only("SOURCE_AFTER").bytes);
  const currentTrees = await repositoryTrees(repositories);
  requireProof(JSON.stringify(before.repositoryTrees) === JSON.stringify(currentTrees) &&
    JSON.stringify(result.inputs.sourceTreeDigests) === JSON.stringify({...currentTrees, stageInputs: currentDigest}), "EVIDENCE_STALE");
  requireProof(JSON.stringify(before) === JSON.stringify(after) && before.stageInputSha256 === currentDigest &&
    JSON.stringify(before.repositoryHeads) === JSON.stringify(result.inputs.repositoryHeads), "EVIDENCE_STALE");
  requireProof(stage.tests.length > 0 && result.commands.length === stage.tests.length &&
    result.outputs.filter(output => output.kind === "COMMAND").length === stage.tests.length &&
    result.outputs.filter(output => Object.values(reportKinds).includes(output.kind)).length === stage.tests.length, "COMMAND_REPORT_MISSING");
  const cores = await currentCoreIdentities(definition, stage.id, root);
  if (stageCoreIds(stage.id).length) {
    const recorded = only("CORE_IDENTITIES");
    matchCoreIdentities(cores, JSON.parse(recorded.bytes), result.inputs.coreIdentities, recorded.artifact.path);
  } else {requireProof(result.inputs.coreIdentities.length === 0, "CORE_IDENTITY_PROOF_INVALID");}
  if (needsProviderIdentity(stage.id)) {
    const recorded = only("PROVIDER_IDENTITIES");
    matchProviderIdentities(await currentProviderIdentities(definition, cores, root), JSON.parse(recorded.bytes), result.inputs.providerIdentities, recorded.artifact.path);
  } else {requireProof(result.inputs.providerIdentities.length === 0, "PROVIDER_IDENTITY_PROOF_INVALID");}
  const actual = [];
  for (const [index, spec] of stage.tests.entries()) {
    const summary = result.commands[index], report = files.get(summary.reportPath), command = files.get(join(runRoot, `test-${index}.command.json`));
    requireProof(report?.artifact.kind === reportKinds[spec.runner] && command?.artifact.kind === "COMMAND", "COMMAND_REPORT_MISSING");
    requireProof(files.get(summary.stdoutPath)?.artifact.kind === "STDOUT" && files.get(summary.stderrPath)?.artifact.kind === "STDERR", "COMMAND_LOG_MISSING");
    const record = JSON.parse(command.bytes), expected = testCommand(spec.runner, spec.files, summary.reportPath, root);
    requireProof(record.exitCode === 0 && record.signal == null && record.timedOut === false && record.cwd === root &&
      record.executable === expected.executable && JSON.stringify(record.args) === JSON.stringify(expected.args) &&
      JSON.stringify(commandSummary(record, summary.reportPath, hash(report.bytes))) === JSON.stringify(summary), "COMMAND_REPORT_FAILED");
    if (spec.runner === "playwright") requireProof(record.env?.PLAYWRIGHT_JSON_OUTPUT_NAME === summary.reportPath, "COMMAND_REPORT_FAILED");
    actual.push(...proofAssertions(JSON.parse(report.bytes), spec.runner, summary.reportPath));
  }
  requireProof(JSON.stringify(actual) === JSON.stringify(result.assertions) &&
    JSON.stringify(JSON.parse(only("ASSERTIONS").bytes)) === JSON.stringify(actual), "ASSERTIONS_REPORT_MISMATCH");
  requireProof(result.metricsPath === null || files.get(result.metricsPath)?.artifact.kind === "METRICS", "METRICS_MISSING");
  for (const identity of [...result.inputs.providerIdentities, ...result.inputs.coreIdentities]) {
    const source = files.get(identity.evidencePath); requireProof(source, "IDENTITY_PROOF_MISSING");
    let value = JSON.parse(source.bytes);
    for (const part of identity.reportLocation.slice(1).split("/")) {
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      requireProof(value !== null && typeof value === "object" && Object.hasOwn(value, key), "IDENTITY_PROOF_MISSING"); value = value[key];
    }
    requireProof(value === identity.sha256, "IDENTITY_PROOF_MISMATCH");
  }
}
