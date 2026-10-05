// @vitest-environment node
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect, it} from "vitest";
import {readPFBProviderCoreFiles, requireBaseContentPairs} from "../scripts/pfb-provider-cores.mjs";
import {emulatorJsDevelopmentCoreSources} from "../src/providers/emulatorjs/development-core-sources.js";

it("loads the full owned Azahar candidate and rejects a missing public base asset or changed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pfb-content-core-"));
  try {
    const directory = join(root, "candidate"); await mkdir(directory);
    const source = emulatorJsDevelopmentCoreSources.find(source => source.id === "azahar")!;
    const files = [], index: Record<string, {sha256: string; sizeBytes: number}> = {};
    for (const file of source.files) {
      const bytes = Buffer.from(`owned ${file.filename}`), sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(directory, file.filename), bytes);
      files.push({filename: file.filename, sizeBytes: bytes.length, sha256});
      index[file.output.includes("/licenses/") ? `licenses/emulatorjs/${file.output}` : `assets/${file.output}`] = {sha256, sizeBytes: bytes.length};
    }
    await writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify({
      schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: source.id, repository: source.repository,
      adapterAbi: source.adapterAbi, branch: "feat/test", commit: "a".repeat(40), dirty: true,
      sourceTreeSha256: "b".repeat(64), files,
    }));
    await writeFile(join(root, "core-inputs.json"), JSON.stringify({schemaVersion: 1, cores: [{id: source.id, directory}]}));
    expect((await readPFBProviderCoreFiles(root, "emulatorjs", root, index)).map(file => file.path).sort()).toEqual(Object.keys(index).sort());
    const missing = {...index}; delete missing["assets/4.3.0-pre/data/cores/reports/azahar.json"];
    await expect(readPFBProviderCoreFiles(root, "emulatorjs", root, missing)).rejects.toThrow("PFB_PROVIDER_CORE_INPUT_INVALID");
    await writeFile(join(directory, "azahar-thread-wasm.data"), "tampered");
    await expect(readPFBProviderCoreFiles(root, "emulatorjs", root, index)).rejects.toThrow("EMULATORJS_CORE_CANDIDATE_INVALID");
  } finally {await rm(root, {recursive: true, force: true});}
});

it("keeps a base DAT and cartridge catalog paired with their exact core bytes", () => {
  const core = {path: "assets/core.data", sha256: "a".repeat(64)};
  const catalog = {path: "assets/requirements.json", sha256: "b".repeat(64)};
  const targets = [{contentRequirements: {kind: "FLYCAST_CARTRIDGE" as const, platform: "naomi" as const, core, catalog}},
    {arcadeDAT: {format: "ARCADE_XML" as const, core, asset: catalog, provenance: {path: "assets/pair.json", sha256: "c".repeat(64)}}}];
  expect(() => requireBaseContentPairs(targets, [core, catalog])).not.toThrow();
  for (const reference of [core, catalog, targets[1]!.arcadeDAT!.provenance]) {
    expect(() => requireBaseContentPairs(targets, [{...reference, sha256: "f".repeat(64)}]))
      .toThrow("PFB_PROVIDER_CONTENT_PAIR_REQUIRES_BASE_UPDATE");
  }
});
