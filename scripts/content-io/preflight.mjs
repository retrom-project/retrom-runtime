import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {absolutePath, argumentsFor, atomicJSON, main, within} from "./cli.mjs";

export const runtimeRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/u, "");
export function readPFB(retrom, pfb) {
  return JSON.parse(execFileSync("python3", [fileURLToPath(new URL("pfb-environment.py", import.meta.url)), retrom, runtimeRoot, pfb],
    {encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120000}));
}
function tool(executable, args) {
  try {
    const path = executable.startsWith("/") ? executable : execFileSync("which", [executable], {encoding: "utf8"}).trim();
    return {path, version: execFileSync(path, args, {encoding: "utf8", timeout: 15000}).trim()};
  } catch {return null;}
}
export async function outputPaths(retrom, args) {
  const evidenceRoot = join(retrom, ".pfb/workspace/content-io");
  const candidateRoot = args["candidate-root"] ? within(join(retrom, ".pfb/candidates"), await absolutePath(args["candidate-root"], true)) : join(retrom, ".pfb/candidates/runtime");
  const candidateBaseRoot = args["candidate-base-root"] ? within(evidenceRoot, await absolutePath(args["candidate-base-root"], true)) : join(evidenceRoot, "candidate-base");
  return {evidenceRoot, candidateRoot, candidateBaseRoot, runtimeCandidateOut: candidateRoot};
}
export async function preflight() {
  const args = argumentsFor({"retrom-root": {type: "string"}, pfb: {type: "string"}, output: {type: "string"}, "candidate-root": {type: "string"}, "candidate-base-root": {type: "string"}}, ["retrom-root", "pfb", "output"]);
  if (args.help) {console.log("preflight --retrom-root <absolute Retrom worktree> --pfb <existing name> --output <absolute environment.json> [--candidate-root <absolute output under PFB candidates>] [--candidate-base-root <absolute output under evidence root>]"); return;}
  const retrom = await absolutePath(args["retrom-root"]);
  const context = readPFB(retrom, args.pfb);
  const paths = await outputPaths(retrom, args), evidenceRoot = paths.evidenceRoot;
  const output = within(evidenceRoot, await absolutePath(args.output, true));
  const productionPins = {};
  for (const id of ["emulatorjs", "retrom-runtime"]) {
    const bytes = await readFile(join(retrom, `data/runtime-providers/${id}.lock.json`));
    productionPins[id] = {lock: JSON.parse(bytes), fileSha256: createHash("sha256").update(bytes).digest("hex")};
  }
  const tools = {node: tool(process.execPath, ["--version"]), npm: tool("npm", ["--version"]),
    python: tool("python3", ["--version"]), go: tool("go", ["version"]),
    chrome: tool(process.env.RETROM_CHROME_EXECUTABLE ?? join(retrom, ".cache/tools/retrom-chrome-for-testing"), ["--version"])};
  const commands = {runtime: ["lint", "typecheck", "test", "build", "package:check"].map((name) =>
    ({cwd: runtimeRoot, executable: "npm", args: ["run", name]})), cores: {}};
  for (const [id, core] of Object.entries(context.repositories.cores)) {
    commands.cores[id] = {cwd: retrom, executable: "make", args: ["pfb-core-build", `PFB=${args.pfb}`, `CORE=${core.buildId}`]};
  }
  const environment = {schemaVersion: 1, pfb: context.pfb, repositories: context.repositories, tools, productionPins, commands,
    paths,
    availability: {browser: tools.chrome ? {status: "AVAILABLE", reason: "Version probe succeeded; product checks still required"} :
      {status: "BLOCKED_ENV", reason: "Chrome executable unavailable"},
    coreSources: Object.fromEntries(Object.entries(context.repositories.cores).map(([id, core]) => [id, core.availability])),
    productFixtures: {status: "NOT_VERIFIED", reason: "Fixture coverage must be established by product-cases inventory"},
    publishAuthorization: {status: "BLOCKED_AUTH", reason: "No release authorization"}}};
  await atomicJSON(output, environment);
  console.log(output);
}
main(import.meta.url, preflight);
