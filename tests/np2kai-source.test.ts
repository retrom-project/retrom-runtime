import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {expect, it} from "vitest";
import {stageNP2Candidate, validNP2Source} from "../scripts/np2kai-source.mjs";
const source = {id: "np2kai", repository: "https://github.com/retrom-project/NP2kai",
  upstreamCommit: "5939e0c6d5985c4c08fc70f289a83290e5d3e6f7", adapterAbi: "np2kai-host-v1"};
it("keeps NP2kai pinned and explicitly unpublished during the PFB trial", async () => {
  const sources = JSON.parse(await readFile("provider-sources.json", "utf8"));
  expect(sources.developmentInputs).toEqual([source]);
  expect(validNP2Source(source)).toBe(true);
  expect(validNP2Source({...source, upstreamCommit: "wx_alpha"})).toBe(false);
  expect(validNP2Source({...source, targetId: "injected"})).toBe(false);
});
it("stages exact verified core assets and rejects corruption, extras and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "np2-candidate-"));
  const input = join(root, "input"), stage = pathToFileURL(join(root, "stage") + "/");
  await mkdir(input);
  try {
    const names = ["LICENSE", "font.bmp", "np2kai-register.mjs", "np2kai.mjs", "np2kai.wasm"];
    const files = [];
    for (const filename of names) {
      const bytes = Buffer.from(filename);
      await writeFile(join(input, filename), bytes);
      files.push({filename, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    }
    await writeFile(join(input, "retrom-core-candidate.json"), JSON.stringify({schemaVersion: 1,
      kind: "RETROM_CORE_CANDIDATE_V1", coreId: source.id, repository: source.repository,
      adapterAbi: source.adapterAbi, commit: source.upstreamCommit, branch: "feat/pc98", dirty: true,
      sourceTreeSha256: "a".repeat(64), files}));
    expect(await stageNP2Candidate(source, input, stage)).toEqual([
      "licenses/np2kai/LICENSE", "licenses/np2kai/retrom-core-candidate.json", ...names.slice(1).map(name => `runtime/np2kai/${name}`),
    ]);
    await writeFile(join(input, "extra"), "x");
    await expect(stageNP2Candidate(source, input, stage)).rejects.toThrow("NP2KAI_CANDIDATE_INVALID");
    await rm(join(input, "extra"));
    await writeFile(join(input, "np2kai.wasm"), "corrupted");
    await expect(stageNP2Candidate(source, input, stage)).rejects.toThrow("NP2KAI_CANDIDATE_INVALID");
    await rm(join(input, "np2kai.wasm"));
    await symlink(join(input, "LICENSE"), join(input, "np2kai.wasm"));
    await expect(stageNP2Candidate(source, input, stage)).rejects.toThrow("NP2KAI_CANDIDATE_INVALID");
  } finally {await rm(root, {recursive: true, force: true});}
});
