import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, readFile, readdir, realpath} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join, relative} from "node:path";
import {absolutePath, within} from "./cli.mjs";
import {checkCurrentProviderBuild, sourceTreeSha256} from "../provider-release.mjs";
import {contractHash} from "./contract.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const needsProviderIdentity = stage => ["S18", "S19", "S20", "S21"].includes(stage);
async function filesBelow(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, path));
    else {assert.ok(entry.isFile() && !entry.isSymbolicLink(), "CONTENT_IO_CANDIDATE_FILES_INVALID"); result.push(relative(root, path));}
  }
  return result.sort();
}
export async function verifyCandidateFiles(directory, descriptor) {
  assert.ok(Array.isArray(descriptor.files) && descriptor.files.length > 0, "CONTENT_IO_CANDIDATE_FILES_INVALID");
  assert.deepEqual((await filesBelow(directory)).filter(path => path !== "retrom-runtime-candidate.json"),
    descriptor.files.map(file => file.path).sort(), "CONTENT_IO_CANDIDATE_FILES_INVALID");
  for (const file of descriptor.files) {
    const path = within(directory, join(directory, file.path)); await absolutePath(path);
    const info = await lstat(path); assert.ok(info.isFile() && info.size === file.sizeBytes, "CONTENT_IO_CANDIDATE_ASSET_INVALID");
    const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk);
    assert.equal(hash.digest("hex"), file.sha256, "CONTENT_IO_CANDIDATE_ASSET_INVALID");
  }
}
export function matchProviderIdentities(actual, recorded, identities, evidencePath) {
  assert.deepEqual(recorded, actual, "CONTENT_IO_PROVIDER_IDENTITY_PROOF_INVALID");
  assert.deepEqual(identities, actual.map((entry, index) => ({id: entry.id, sha256: entry.bundleSha256,
    evidencePath, reportLocation: `/${index}/bundleSha256`})), "CONTENT_IO_PROVIDER_IDENTITY_PROOF_INVALID");
}
export async function currentProviderIdentities(environment, cores, root) {
  const retrom = environment.repositories.retrom.root, paths = environment.paths;
  const directory = await absolutePath(within(join(retrom, ".pfb/candidates"), paths.candidateRoot));
  const bytes = await readFile(join(directory, "retrom-runtime-candidate.json")), descriptor = JSON.parse(bytes);
  assert.equal(descriptor.kind, "RETROM_RUNTIME_PROVIDER_CANDIDATE_V2", "CONTENT_IO_PROVIDER_CANDIDATE_INVALID");
  assert.equal(descriptor.schemaVersion, 2, "CONTENT_IO_PROVIDER_CANDIDATE_INVALID");
  assert.equal(descriptor.sourceTreeSha256, sourceTreeSha256(root), "CONTENT_IO_PROVIDER_SOURCE_STALE");
  await verifyCandidateFiles(directory, descriptor);
  for (const core of cores) {
    const actual = descriptor.coreInputs.filter(input => input.id === core.id);
    assert.equal(actual.length, 1, "CONTENT_IO_PROVIDER_CORE_MISMATCH");
    assert.deepEqual(actual[0], {id: core.id, mode: "branch", ...Object.fromEntries(
      ["repository", "branch", "commit", "dirty", "sourceTreeSha256", "adapterAbi", "files"].map(key => [key, core.descriptor[key]])),
    descriptorSha256: core.descriptorSha256}, "CONTENT_IO_PROVIDER_CORE_MISMATCH");
  }
  const providerBuild = await readFile(join(directory, "providers/provider-build.json"));
  assert.equal(sha(providerBuild), descriptor.providerBuildSha256, "CONTENT_IO_PROVIDER_BUILD_MISMATCH");
  const verified = await checkCurrentProviderBuild({outputRoot: join(directory, "providers")});
  assert.equal(verified.metadata.sourceTreeSha256, descriptor.sourceTreeSha256, "CONTENT_IO_PROVIDER_BUILD_MISMATCH");
  const active = await installedProviders(environment), expectedContract = await contractHash();
  return Promise.all(verified.providers.map(async entry => {
    const provider = active.providers.find(provider => provider.providerId === entry.metadata.providerId);
    assert.ok(provider && provider.bundleSha256 === entry.metadata.bundleSha256, "CONTENT_IO_PROVIDER_BASE_MISMATCH");
    for (const name of ["worker", ...(provider.providerId === "retrom-runtime" ? ["sync-client"] : [])]) {
      assert.ok((await readFile(join(entry.bundleRoot, `assets/content-io/${name}.mjs`))).includes(Buffer.from(expectedContract)), "CONTENT_IO_PROVIDER_CONTRACT_MISMATCH");
    }
    return {id: provider.providerId, bundleSha256: provider.bundleSha256, moduleSha256: provider.moduleSha256,
      providerVersion: provider.providerVersion, candidateSha256: sha(bytes), providerBuildSha256: sha(providerBuild),
      sourceTreeSha256: descriptor.sourceTreeSha256, activeSha256: sha(Buffer.from(JSON.stringify(active)))};
  }));
}
async function installedProviders(environment) {
  const root = environment.repositories.retrom.root;
  const base = await absolutePath(within(environment.paths.evidenceRoot, environment.paths.candidateBaseRoot));
  const python = await realpath(environment.tools.python.path);
  const check = directory => JSON.parse(execFileSync(python, ["scripts/runtime_providers.py", "check", "--source", "candidate",
    "--active-path", join(directory, "active.json"), "--installed-root", join(directory, "installed")], {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 4194304}));
  const prepared = check(base), installed = check(join(root, ".pfb/workspace/providers"));
  assert.deepEqual(installed, prepared, "CONTENT_IO_PROVIDER_BASE_MISMATCH"); return installed;
}
