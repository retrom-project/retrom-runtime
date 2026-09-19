import {verifyProof} from "./result-proof.mjs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile, lstat} from "node:fs/promises";
import {dirname, join} from "node:path";
import {absolutePath, argumentsFor, main, within} from "./cli.mjs";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function inputDigest(root, prefixes) {
  const files = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {encoding: "utf8"})
    .split("\0").filter((path) => path && prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
  const entries = [];
  for (const path of [...new Set(files)].sort()) {
    const full = within(root, join(root, path));
    try {
      const stat = await lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink()) {throw new Error("CONTENT_IO_INPUT_NOT_REGULAR");}
      entries.push([path, stat.mode & 0o111, hash(await readFile(full))]);
    } catch (error) {if (error.code !== "ENOENT") {throw error;}}
  }
  if (entries.length === 0) {throw new Error("CONTENT_IO_INPUTS_MISSING");}
  return hash(JSON.stringify(entries));
}
export function coverage(required, assertions) {
  if (!required.length || !assertions.length) {throw new Error("CONTENT_IO_ZERO_ASSERTIONS");}
  const missing = required.filter(({caseId, subcase, level}) => !assertions.some((assertion) =>
    assertion.status === "passed" && (assertion.caseId !== undefined ?
      assertion.caseId === caseId && assertion.level === level && assertion.subcase === subcase : [...assertion.name.matchAll(/\[([A-Z]+-?\d+)\] (CONTRACT|UNIT|BROWSER|CORE|PRODUCT)\/([^\s[]+)/gu)]
      .some(match => match[1] === caseId && match[2] === level && match[3] === subcase))));
  if (missing.length) {throw new Error(`CONTENT_IO_CASE_MISSING:${JSON.stringify(missing)}`);}
  if (assertions.some((assertion) => assertion.status !== "passed")) {throw new Error("CONTENT_IO_ASSERTION_FAILED");}
}
export async function verifyResult(result, stage, root, runRoot) {
  await verifyProof(result, stage, root, runRoot, hash, await inputDigest(root, stage.inputs));
  coverage(stage.required, result.assertions);
}
export function selectEvidenceStages(stages, args) {
  if ([args.all, args.candidate, args.stage].filter(Boolean).length !== 1 || args.stage && !/^S(?:0\d|1\d|2[0-2])$/u.test(args.stage)) {
    throw Object.assign(new Error("CONTENT_IO_STAGE_INVALID"), {exitCode: 2});
  }
  return stages.filter(entry => args.all || args.candidate && entry.id !== "S22" || entry.id === args.stage);
}
export async function checkEvidence() {
  const args = argumentsFor({env: {type: "string"}, stage: {type: "string"}, all: {type: "boolean"}, candidate: {type: "boolean"}}, ["env"]);
  if (args.help) {console.log("evidence --env <absolute environment.json> (--stage Sxx | --candidate | --all)"); return;}
  const environment = JSON.parse(await readFile(await absolutePath(args.env), "utf8"));
  const stages = JSON.parse(await readFile(new URL("../../tests/content-io/stages.json", import.meta.url), "utf8"));
  const state = JSON.parse(await readFile(join(environment.paths.evidenceRoot, "implementation-state.json"), "utf8"));
  for (const stage of selectEvidenceStages(stages, args)) {
    const path = state[stage.id]?.resultPath;
    if (!path) {throw new Error(`CONTENT_IO_STAGE_NOT_RUN:${stage.id}`);}
    within(environment.paths.evidenceRoot, path);
    await verifyResult(JSON.parse(await readFile(path, "utf8")), stage, environment.repositories.runtime.root, dirname(path));
  }
}
main(import.meta.url, checkEvidence);
