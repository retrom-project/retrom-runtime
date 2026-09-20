import {currentProviderIdentities, needsProviderIdentity} from "./provider-identities.mjs";
import {currentCoreIdentities} from "./core-identities.mjs";
import {readFile, writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {atomicJSON} from "./cli.mjs";
import {hash, inputDigest} from "./evidence.mjs";
import {repositoryTrees} from "./repository-tree.mjs";
import {contractHash} from "./contract.mjs";
export function repositories(context) {
  return {runtime: context.repositories.runtime, retrom: context.repositories.retrom,
    ...Object.fromEntries(Object.entries(context.repositories.cores).map(([id, value]) => [`core:${id}`, value]))};
}
export async function sourceSnapshot(context, stage, root) {
  const repositoryHeads = {};
  for (const [id, repository] of Object.entries(repositories(context))) {
    if (repository.commit) repositoryHeads[id] = execFileSync("git", ["-C", repository.root, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  }
  return {repositoryHeads, repositoryTrees: await repositoryTrees(context.repositories), stageInputSha256: await inputDigest(root, stage.inputs)};
}
export async function addOutput(result, path, kind) {
  const bytes = await readFile(path);
  result.outputs.push({path, kind, sizeBytes: bytes.length, sha256: hash(bytes)}); return bytes;
}
export async function writeOutput(result, path, kind, value) {
  await atomicJSON(path, value); return addOutput(result, path, kind);
}
export async function beginResult(context, stage, root, runId, runRoot, environmentBytes) {
  const before = await sourceSnapshot(context, stage, root);
  const result = {schemaVersion: 1, runId, stageId: stage.id, status: "FAIL", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    inputs: {repositoryHeads: before.repositoryHeads,
      sourceTreeDigests: {...before.repositoryTrees, stageInputs: before.stageInputSha256},
      environmentDigest: hash(environmentBytes), contractSha256: await contractHash(), providerIdentities: [], coreIdentities: []},
    commands: [], assertions: [], metricsPath: null, outputs: [], blockingReasons: []};
  // Keep exact environment bytes, so the digest also authenticates formatting and schema.
  const environmentPath = join(runRoot, "environment.json"); await writeFile(environmentPath, environmentBytes, {flag: "wx", mode: 0o600});
  await addOutput(result, environmentPath, "ENVIRONMENT");
  await writeOutput(result, join(runRoot, "source-before.json"), "SOURCE_BEFORE", before);
  return {result, before};
}

export async function captureCoreInputs(result, context, stage, root, runRoot) {
  const cores = await currentCoreIdentities(context, stage.id, root);
  if (cores.length) {
    const evidencePath = join(runRoot, "core-identities.json");
    await writeOutput(result, evidencePath, "CORE_IDENTITIES", cores);
    result.inputs.coreIdentities = cores.map((entry, index) => ({id: entry.id, sha256: entry.descriptorSha256,
      evidencePath, reportLocation: `/${index}/descriptorSha256`}));
  }
  return cores;
}

export async function captureProviderInputs(result, environment, stage, root, runRoot, cores) {
  if (!needsProviderIdentity(stage.id)) return;
  const providers = await currentProviderIdentities(environment, cores, root), evidencePath = join(runRoot, "provider-identities.json");
  await writeOutput(result, evidencePath, "PROVIDER_IDENTITIES", providers);
  result.inputs.providerIdentities = providers.map((entry, index) => ({id: entry.id, sha256: entry.bundleSha256,
    evidencePath, reportLocation: `/${index}/bundleSha256`}));
}
