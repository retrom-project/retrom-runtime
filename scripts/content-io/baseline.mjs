import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {absolutePath, argumentsFor, main} from "./cli.mjs";
import {readPFB} from "./preflight.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function collectBaseline() {
  const args = argumentsFor({env: {type: "string"}}, ["env"]);
  if (args.help) {console.log("baseline --env <absolute environment.json>; immutable capture after baseline commands"); return;}
  const env = JSON.parse(await readFile(await absolutePath(args.env), "utf8"));
  const context = readPFB(env.repositories.retrom.root, env.pfb.name);
  const artifacts = [], gates = [];
  for (const name of ["lint", "typecheck", "test", "build", "package-check", "host-content-ready", "pfb"]) {
    const path = join(env.paths.evidenceRoot, "baseline", `${name}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    if (record.exitCode !== 0 || !Array.isArray(record.command) || !Array.isArray(record.containerCommand)) {
      throw new Error(`CONTENT_IO_BASELINE_FAILED:${name}`);
    }
    gates.push({name, ...record});
    for (const suffix of [".json", ".stdout.log", ".stderr.log"]) {
      const file = path.replace(/\.json$/u, suffix); artifacts.push({path: file, sha256: digest(await readFile(file))});
    }
  }
  const {projectProviderManifest} = await import(pathToFileURL(join(env.repositories.runtime.root, "dist/provider/manifest.js")));
  const {retromRuntimeProviderDefinition} = await import(pathToFileURL(join(env.repositories.runtime.root, "dist/providers/retrom-runtime/catalog.js")));
  const {emulatorJsProviderDefinition} = await import(pathToFileURL(join(env.repositories.runtime.root, "dist/providers/emulatorjs/catalog.js")));
  const entrypoints = JSON.parse(await readFile(join(env.paths.evidenceRoot, "entrypoints.json"), "utf8"));
  if (entrypoints.entries.filter((entry) => entry.id.startsWith("R-")).length !== 6) {throw new Error("CONTENT_IO_BASELINE_RANGE_INCOMPLETE");}
  const difference = [];
  for (const entry of entrypoints.entries) {
    const repository = entry.repository === "runtime" ? context.repositories.runtime : context.repositories.cores[entry.repository];
    const bytes = execFileSync("git", ["-C", repository.root, "show", `${repository.commit}:${entry.path}`]);
    if (digest(bytes) !== entry.sourceSha256) {throw new Error(`CONTENT_IO_BASELINE_ALREADY_CHANGED:${entry.id}`);}
    difference.push({id: entry.id, classification: "UNCHANGED", comparedCommit: repository.commit, path: entry.path, sha256: entry.sourceSha256});
  }
  const baseline = {schemaVersion: 1, repositories: context.repositories, productionPins: env.productionPins, gates, artifacts,
    manifests: [retromRuntimeProviderDefinition, emulatorJsProviderDefinition].map(projectProviderManifest),
    environmentCorrections: ["Host first invocation selected empty runtime directory; corrected to runtime/...",
      "Fresh Host lacked locked DAT/auth payloads; make prepare-deps succeeded, then complete selected Host suites passed"],
    migrationOrder: "S14 mkxp follows other core migrations by user request"};
  await writeFile(join(env.paths.evidenceRoot, "baseline.json"), JSON.stringify(baseline, null, 2) + "\n", {flag: "wx"});
  await writeFile(join(env.paths.evidenceRoot, "baseline-diff.json"), JSON.stringify(difference, null, 2) + "\n", {flag: "wx"});
}
main(import.meta.url, collectBaseline);
