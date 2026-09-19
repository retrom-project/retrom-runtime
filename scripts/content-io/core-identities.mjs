import {contractHash} from "./contract.mjs";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {verifyCoreInput} from "./prepare-candidate-inputs.mjs";
import {readPFB} from "./preflight.mjs";
const stages = {S12: ["ppsspp"], S13: ["play"], S14: ["mkxp"], S15: ["kirikiri2"], S18: ["kirikiri2", "mkxp", "play", "ppsspp"], S19: ["kirikiri2", "mkxp", "play", "ppsspp"], S20: ["kirikiri2", "mkxp", "play", "ppsspp"], S21: ["kirikiri2", "mkxp", "play", "ppsspp"]};
export const stageCoreIds = stage => [...stages[stage] ?? []];
export async function currentCoreIdentities(environment, stage, runtimeRoot) {
  const ids = stageCoreIds(stage); if (!ids.length) return [];
  const context = readPFB(environment.repositories.retrom.root, environment.pfb.name);
  const sources = JSON.parse(await readFile(join(runtimeRoot, "provider-sources.json"), "utf8"));
  const expectedContract = await contractHash();
  const entries = [...sources.upstreamReleases, ...sources.developmentInputs ?? []], result = [];
  for (const id of ids) {
    const directory = join(context.repositories.retrom.root, ".pfb/workspace/core-builds", id, "current");
    const verified = await verifyCoreInput(id, directory, entries.find(source => source.id === id), context.repositories.cores[id], expectedContract);
    result.push({id, descriptorSha256: verified.descriptorSha256, descriptor: verified.descriptor});
  }
  return result;
}
export function matchCoreIdentities(actual, recorded, identities, evidencePath) {
  if (JSON.stringify(actual) !== JSON.stringify(recorded) || JSON.stringify(identities) !== JSON.stringify(actual.map((entry, index) => ({
    id: entry.id, sha256: entry.descriptorSha256, evidencePath, reportLocation: `/${index}/descriptorSha256`,
  })))) throw new Error("CONTENT_IO_CORE_IDENTITY_PROOF_INVALID");
}
