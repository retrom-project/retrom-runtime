// @vitest-environment node
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {it, expect} from "vitest";
import {readEmulatorJsCoreCandidate, readPinnedEmulatorJsCoreCandidate, validEmulatorJsCoreSource} from "../scripts/emulatorjs-core-candidate.mjs";

it("accepts only declared candidate bytes and rejects release mode and digest drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "ejs-core-"));
  try {
    const bytes = Buffer.from("core bytes");
    const file = {filename: "flycast-wasm.data", sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")};
    const outputs = {"flycast-wasm.data": "4.2.3/data/cores/flycast-wasm.data",
      "flycast.json": "4.2.3/data/cores/reports/flycast.json",
      "flycast-rom-requirements.json": "4.2.3/data/cores/flycast-rom-requirements.json",
      LICENSE: "4.2.3/licenses/forks/flycast/LICENSE"};
    const files = Object.entries(outputs).map(([filename, output]) => ({...file, filename, output}));
    const source = {id: "flycast", repository: "https://github.com/retrom-project/flycast-wasm",
      adapterAbi: "emulatorjs-flycast-state-v1", files};
    for (const entry of files) {await writeFile(join(root, entry.filename), bytes);}
    await writeFile(join(root, "retrom-core-candidate.json"), JSON.stringify({
      schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: source.id,
      repository: source.repository, adapterAbi: source.adapterAbi,
      branch: "feat/flycast", commit: "a".repeat(40), dirty: true,
      sourceTreeSha256: "b".repeat(64), files: files.map(({output: _output, ...entry}) => entry),
    }));
    expect((await readEmulatorJsCoreCandidate(source, root, true)).get(source.files[0]!.output)).toEqual(bytes);
    await expect(readEmulatorJsCoreCandidate(source, root, false)).rejects.toThrow("UNPUBLISHED_CORE_INPUT");
    const previousRelease = {...source, files: files.map(entry => ({...entry, sha256: "c".repeat(64), sizeBytes: 42}))};
    expect((await readEmulatorJsCoreCandidate(previousRelease, root, true)).get(source.files[0]!.output)).toEqual(bytes);
    await expect(readPinnedEmulatorJsCoreCandidate(previousRelease, root, true)).rejects.toThrow("EMULATORJS_CORE_CANDIDATE_DECLARATION_MISMATCH");
    expect((await readPinnedEmulatorJsCoreCandidate(source, root, true)).get(source.files[0]!.output)).toEqual(bytes);
    for (const missing of files) {
      const incomplete = {...source, files: files.filter(entry => entry !== missing)};
      expect(validEmulatorJsCoreSource(incomplete)).toBe(false);
      await expect(readEmulatorJsCoreCandidate(incomplete, root, true)).rejects.toThrow("EMULATORJS_CORE_CANDIDATE_INVALID");
    }
    await writeFile(join(root, file.filename), "bad bytes!");
    await expect(readEmulatorJsCoreCandidate(source, root, true)).rejects.toThrow("EMULATORJS_CORE_CANDIDATE_INVALID");
  } finally {await rm(root, {recursive: true, force: true});}
});
