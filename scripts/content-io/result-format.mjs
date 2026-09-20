import {isAbsolute} from "node:path";
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const text = value => typeof value === "string" && value.length > 0;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const strings = value => Array.isArray(value) && value.every(text);
const path = value => text(value) && isAbsolute(value);
const instant = value => text(value) && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const primitive = value => value === null || typeof value === "boolean" || typeof value === "string" && value.length <= 4096 ||
  typeof value === "number" && Number.isFinite(value) || Array.isArray(value) && value.length <= 100 && value.every(item => !Array.isArray(item) && primitive(item));
export const reportKinds = {node: "NODE_REPORT", vitest: "VITEST_REPORT", playwright: "PLAYWRIGHT_REPORT"};
export function requireProof(condition, reason) {if (!condition) throw new Error(`CONTENT_IO_${reason}`);}
export function validateResult(result) {
  requireProof(exact(result, ["schemaVersion", "runId", "stageId", "status", "startedAt", "endedAt", "inputs", "commands", "assertions", "metricsPath", "outputs", "blockingReasons"]), "RESULT_SCHEMA");
  requireProof(result.schemaVersion === 1 && text(result.runId) && text(result.stageId) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(result.runId) &&
    /^S(?:0\d|1\d|2[0-2])$/u.test(result.stageId) && ["PASS", "FAIL", "BLOCKED_ENV", "BLOCKED_AUTH", "INVALIDATED"].includes(result.status), "RESULT_IDENTITY");
  requireProof(instant(result.startedAt) && instant(result.endedAt) && Date.parse(result.endedAt) >= Date.parse(result.startedAt), "RESULT_TIME");
  validateInputs(result.inputs);
  requireProof(Array.isArray(result.commands) && result.commands.every(validCommand), "COMMAND_SCHEMA");
  requireProof(Array.isArray(result.assertions) && result.assertions.every(validAssertion), "ASSERTION_SCHEMA");
  requireProof(result.metricsPath === null || path(result.metricsPath), "METRICS_SCHEMA");
  requireProof(Array.isArray(result.outputs) && result.outputs.every(output => exact(output, ["path", "sizeBytes", "sha256", "kind"]) &&
    path(output.path) && Number.isSafeInteger(output.sizeBytes) && output.sizeBytes >= 0 && digest(output.sha256) &&
    ["ENVIRONMENT", "SOURCE_BEFORE", "SOURCE_AFTER", "COMMAND", "STDOUT", "STDERR", "ASSERTIONS", "METRICS", "CORE_IDENTITIES", "PROVIDER_IDENTITIES", "ARTIFACT", ...Object.values(reportKinds)].includes(output.kind)), "OUTPUT_SCHEMA");
  requireProof(new Set(result.outputs.map(output => output.path)).size === result.outputs.length, "OUTPUT_DUPLICATE");
  requireProof(Array.isArray(result.blockingReasons) && result.blockingReasons.every(reason => exact(reason, ["code", "affectedStage", "evidence", "nextPermittedAction"]) &&
    text(reason.code) && reason.affectedStage === result.stageId && (reason.evidence === null || path(reason.evidence)) && text(reason.nextPermittedAction)), "BLOCKING_SCHEMA");
  requireProof(result.status !== "PASS" || result.blockingReasons.length === 0, "PASS_WITH_BLOCKER");
}
function validateInputs(inputs) {
  requireProof(exact(inputs, ["repositoryHeads", "sourceTreeDigests", "environmentDigest", "contractSha256", "providerIdentities", "coreIdentities"]), "INPUT_SCHEMA");
  for (const [name, predicate] of [["repositoryHeads", value => text(value) && /^[a-f0-9]{40}$/u.test(value)], ["sourceTreeDigests", digest]]) {
    const values = inputs[name];
    requireProof(values && typeof values === "object" && !Array.isArray(values) && Object.keys(values).length > 0 && Object.values(values).every(predicate), "INPUT_IDENTITY");
  }
  requireProof(digest(inputs.sourceTreeDigests.stageInputs) && digest(inputs.environmentDigest) && (inputs.contractSha256 === null || digest(inputs.contractSha256)), "INPUT_IDENTITY");
  for (const name of ["providerIdentities", "coreIdentities"]) {
    requireProof(Array.isArray(inputs[name]) && inputs[name].every(value => exact(value, ["id", "sha256", "evidencePath", "reportLocation"]) && text(value.id) && digest(value.sha256) && path(value.evidencePath) && text(value.reportLocation) && value.reportLocation.startsWith("/")), "INPUT_ARTIFACT_IDENTITY");
  }
}
function validCommand(value) {
  return exact(value, ["cwd", "executable", "args", "exitCode", "signal", "stdoutPath", "stderrPath", "reportPath", "reportSha256"]) &&
    path(value.cwd) && path(value.executable) && strings(value.args) && (value.exitCode === null || Number.isInteger(value.exitCode)) &&
    (value.signal === null || text(value.signal)) && path(value.stdoutPath) && path(value.stderrPath) &&
    (value.reportPath === null ? value.reportSha256 === null : path(value.reportPath) && digest(value.reportSha256));
}
function validAssertion(value) {
  return exact(value, ["caseId", "subcase", "level", "status", "expected", "observed", "reportPath", "reportLocation"]) &&
    text(value.caseId) && /^[A-Z]+-?\d+$/u.test(value.caseId) && text(value.subcase) && ["CONTRACT", "UNIT", "BROWSER", "CORE", "PRODUCT"].includes(value.level) &&
    ["passed", "failed"].includes(value.status) && primitive(value.expected) && primitive(value.observed) && path(value.reportPath) &&
    text(value.reportLocation) && value.reportLocation.startsWith("/");
}
export function commandSummary(record, reportPath, reportSha256) {
  return {cwd: record.cwd, executable: record.executable, args: record.args, exitCode: record.exitCode ?? null, signal: record.signal ?? null,
    stdoutPath: record.stdoutPath, stderrPath: record.stderrPath, reportPath, reportSha256};
}
