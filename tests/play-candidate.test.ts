import {mkdtemp, readFile, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {expect, it} from "vitest";
import {playFiles, stagePlayCandidate, validPlaySource} from "../scripts/play-candidate-stage.mjs";
import {sha256, validateProviderSources} from "../scripts/provider-sources.mjs";
import {assertScummvmCandidateMode} from "../scripts/scummvm-release.mjs";
const source = {id: "play", repository: "https://github.com/retrom-project/Play-",
  upstreamCommit: "83700b2c31e593bc94e845b4b31b797be84dda59", adapterAbi: "play-host-v1"};
it("keeps unpublished Play! inputs outside formal releases", async () => {
  const sources: unknown = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(() => validateProviderSources(sources)).not.toThrow();
  expect(validPlaySource({...source, tag: "invented"})).toBe(false);
  expect(() => assertScummvmCandidateMode([source], false, true)).toThrow();
  expect(() => assertScummvmCandidateMode([source], true, false)).not.toThrow();
});
it("stages exactly the fork-declared files and rejects altered candidate bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "play-input-"));
  const stage = await mkdtemp(join(tmpdir(), "play-stage-"));
  try {
    const files = await Promise.all(Object.keys(playFiles).sort().map(async filename => {
      const bytes = Buffer.from(filename);
      await writeFile(join(directory, filename), bytes);
      return {filename, sizeBytes: bytes.length, sha256: sha256(bytes)};
    }));
    await writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify({
      schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "play", repository: source.repository,
      adapterAbi: source.adapterAbi, commit: source.upstreamCommit, dirty: true, branch: "feat/play",
      sourceTreeSha256: "a".repeat(64), files,
    }));
    const output = await stagePlayCandidate(source, directory, pathToFileURL(`${stage}/`));
    expect(output).toContain("licenses/play/LICENSE");
    expect(output).toContain("runtime/play/Play.wasm");
    await writeFile(join(directory, "Play.wasm"), "altered");
    await expect(stagePlayCandidate(source, directory, pathToFileURL(`${stage}/`))).rejects.toThrow("PLAY_CANDIDATE_INVALID");
  } finally {await rm(directory, {recursive: true, force: true}); await rm(stage, {recursive: true, force: true});}
});
