import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
import {sha256} from "../scripts/provider-sources.mjs";
import {stageRuffleCandidate} from "../scripts/ruffle-candidate.mjs";
import {assertScummvmCandidateMode} from "../scripts/scummvm-release.mjs";

export const ruffleSource = {id: "ruffle", repository: "https://github.com/retrom-project/ruffle",
  upstreamCommit: "e46d1642fb67a53b56ffa4b1871cb7c57589e36d", adapterAbi: "ruffle-host-v1",
  assets: ["ruffle.js", "core.ruffle.js", "ruffle.wasm", "LICENSE.md", "LICENSE_MIT", "LICENSE_APACHE"].sort()
    .map((filename) => ({filename, output: filename.startsWith("LICENSE") ? `licenses/ruffle/${filename}` : `runtime/ruffle/${filename}`,
      maxSizeBytes: filename === "ruffle.wasm" ? 67108864 : 4194304}))};

it("accepts fixed Ruffle development bytes without inventing a published release", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  sources.developmentInputs = [structuredClone(ruffleSource)];
  expect(() => validateProviderSources(sources)).not.toThrow();
  sources.developmentInputs[0].tag = "latest";
  expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
});

it("rejects Ruffle input outside explicit PFB builds, including formal releases", () => {
  expect(() => assertScummvmCandidateMode([ruffleSource], true, false)).not.toThrow();
  expect(() => assertScummvmCandidateMode([ruffleSource], false, false)).toThrow("UNPUBLISHED_CORE_INPUT");
  expect(() => assertScummvmCandidateMode([ruffleSource], true, true)).toThrow("UNPUBLISHED_CORE_INPUT");
});

it("stages the closed candidate and refuses tampering or undeclared extra files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ruffle-candidate-test-"));
  try {
    const source = join(directory, "source"); await mkdir(source);
    const bytes = new Uint8Array([1, 2, 3]);
    const files = ruffleSource.assets.map((asset) => ({filename: asset.filename, sizeBytes: 3, sha256: sha256(bytes)}));
    for (const file of files) {await writeFile(join(source, file.filename), bytes);}
    const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "ruffle",
      repository: ruffleSource.repository, adapterAbi: ruffleSource.adapterAbi, branch: "feat/fixture",
      commit: ruffleSource.upstreamCommit, dirty: true, sourceTreeSha256: "a".repeat(64), files};
    await writeFile(join(source, "retrom-core-candidate.json"), JSON.stringify(descriptor));
    const stage = pathToFileURL(join(directory, "stage") + "/");
    expect(await stageRuffleCandidate(ruffleSource, source, stage)).toEqual(ruffleSource.assets.map((asset) => asset.output));
    await writeFile(join(source, "ruffle.wasm"), new Uint8Array([1, 2, 4]));
    await expect(stageRuffleCandidate(ruffleSource, source, stage)).rejects.toThrow("RUFFLE_CANDIDATE_INVALID");
    await writeFile(join(source, "ruffle.wasm"), bytes);
    await writeFile(join(source, "extra"), bytes);
    await expect(stageRuffleCandidate(ruffleSource, source, stage)).rejects.toThrow("RUFFLE_CANDIDATE_INVALID");
  } finally {await rm(directory, {recursive: true, force: true});}
});
