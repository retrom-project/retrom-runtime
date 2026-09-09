import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
import {sha256} from "../scripts/provider-sources.mjs";
import {asOpenBORCandidateSource, stageOpenBORCandidate} from "../scripts/openbor-candidate.mjs";
import {assertScummvmCandidateMode} from "../scripts/scummvm-release.mjs";

export const openborSource = {id: "openbor", repository: "https://github.com/retrom-project/openbor",
  upstreamCommit: "9d81480f8481fbb9e76b0b5f2a5dfa408376761a", adapterAbi: "openbor-host-v1",
  assets: ["openbor.mjs", "openbor.wasm", "LICENSE", "LICENSES.txt"].sort()
    .map((filename) => ({filename, output: filename.startsWith("LICENSE") ? `licenses/openbor/${filename}` : `runtime/openbor/${filename}`,
      maxSizeBytes: filename === "openbor.wasm" ? 67108864 : 4194304}))};

it("accepts fixed OpenBOR development bytes without inventing a published release", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  sources.upstreamReleases = sources.upstreamReleases.filter((source: {id: string}) => source.id !== "openbor");
  sources.developmentInputs = [structuredClone(openborSource)];
  expect(() => validateProviderSources(sources)).not.toThrow();
  sources.developmentInputs[0].tag = "latest";
  expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
});

it("keeps the strict candidate inventory when a published input is overridden in a PFB", () => {
  const release = {...openborSource, tag: "retrom-core-g9d81480f8481-r1", commit: "a".repeat(40),
    assets: openborSource.assets.map((asset) => ({...asset, url: `https://example.com/${asset.filename}`}))};
  expect(asOpenBORCandidateSource(release)).toEqual(openborSource);
  expect(() => asOpenBORCandidateSource({...release, adapterAbi: "unknown"})).toThrow("OPENBOR_CANDIDATE_INVALID");
  expect(() => asOpenBORCandidateSource({...release, assets: release.assets.slice(1)})).toThrow("OPENBOR_CANDIDATE_INVALID");
});

it("rejects OpenBOR input outside explicit PFB builds, including formal releases", () => {
  expect(() => assertScummvmCandidateMode([openborSource], true, false)).not.toThrow();
  expect(() => assertScummvmCandidateMode([openborSource], false, false)).toThrow("UNPUBLISHED_CORE_INPUT");
  expect(() => assertScummvmCandidateMode([openborSource], true, true)).toThrow("UNPUBLISHED_CORE_INPUT");
});

it("stages the closed candidate and refuses tampering or undeclared extra files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openbor-candidate-test-"));
  try {
    const source = join(directory, "source"); await mkdir(source);
    const bytes = new Uint8Array([1, 2, 3]);
    const files = openborSource.assets.map((asset) => ({filename: asset.filename, sizeBytes: 3, sha256: sha256(bytes)}));
    for (const file of files) {await writeFile(join(source, file.filename), bytes);}
    const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "openbor",
      repository: openborSource.repository, adapterAbi: openborSource.adapterAbi, branch: "feat/fixture",
      commit: openborSource.upstreamCommit, dirty: true, sourceTreeSha256: "a".repeat(64), files};
    await writeFile(join(source, "retrom-core-candidate.json"), JSON.stringify(descriptor));
    const stage = pathToFileURL(join(directory, "stage") + "/");
    expect(await stageOpenBORCandidate(openborSource, source, stage)).toEqual(openborSource.assets.map((asset) => asset.output));
    await writeFile(join(source, "openbor.wasm"), new Uint8Array([1, 2, 4]));
    await expect(stageOpenBORCandidate(openborSource, source, stage)).rejects.toThrow("OPENBOR_CANDIDATE_INVALID");
    await writeFile(join(source, "openbor.wasm"), bytes);
    await writeFile(join(source, "extra"), bytes);
    await expect(stageOpenBORCandidate(openborSource, source, stage)).rejects.toThrow("OPENBOR_CANDIDATE_INVALID");
  } finally {await rm(directory, {recursive: true, force: true});}
});
