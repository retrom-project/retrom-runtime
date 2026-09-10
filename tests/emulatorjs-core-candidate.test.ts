// @vitest-environment node
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {it, expect} from "vitest";
import {readEmulatorJsCoreCandidate} from "../scripts/emulatorjs-core-candidate.mjs";

it("accepts only declared candidate bytes and rejects release mode and digest drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "ejs-core-"));
  try {
    const bytes = Buffer.from("core bytes");
    const file = {filename: "flycast-wasm.data", sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")};
    const source = {id: "flycast", repository: "https://github.com/retrom-project/flycast-wasm",
      adapterAbi: "emulatorjs-flycast-state-v1", files: [{...file, output: "4.2.3/data/cores/flycast-wasm.data"}]};
    await writeFile(join(root, file.filename), bytes);
    await writeFile(join(root, "retrom-core-candidate.json"), JSON.stringify({
      schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: source.id,
      repository: source.repository, adapterAbi: source.adapterAbi,
      branch: "feat/flycast", commit: "a".repeat(40), dirty: true,
      sourceTreeSha256: "b".repeat(64), files: [file],
    }));
    expect((await readEmulatorJsCoreCandidate(source, root, true)).get(source.files[0]!.output)).toEqual(bytes);
    await expect(readEmulatorJsCoreCandidate(source, root, false)).rejects.toThrow("UNPUBLISHED_CORE_INPUT");
    await writeFile(join(root, file.filename), "bad bytes!");
    await expect(readEmulatorJsCoreCandidate(source, root, true)).rejects.toThrow("EMULATORJS_CORE_CANDIDATE_INVALID");
  } finally {await rm(root, {recursive: true, force: true});}
});
