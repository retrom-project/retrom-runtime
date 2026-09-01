import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCandidateDeclaration } from "../scripts/candidate-manifest.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PFB new-core candidate declaration", () => {
  it("accepts a bounded path-only declaration and rejects release identity fields", async () => {
    const root = await fixture();
    const value = declaration();
    await writeFile(join(root, "candidate/runtime-candidate.json"), JSON.stringify(value));
    await expect(loadCandidateDeclaration(root)).resolves.toEqual(value);

    await writeFile(join(root, "candidate/runtime-candidate.json"), JSON.stringify({
      ...value,
      tag: "latest",
    }));
    await expect(loadCandidateDeclaration(root)).rejects.toThrow("PFB_CANDIDATE_OUTPUT_INVALID");
  });

  it("requires every artifact file to be supplied by the branch descriptor mapping", async () => {
    const root = await fixture();
    const value = declaration();
    value.artifact.file_paths = ["v0.10.1/not-declared.wasm"];
    await writeFile(join(root, "candidate/runtime-candidate.json"), JSON.stringify(value));
    await expect(loadCandidateDeclaration(root)).rejects.toThrow("new-core-artifact-files");
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "retrom-runtime-candidate-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "candidate"));
  await mkdir(join(root, "src/new-core"), { recursive: true });
  await writeFile(join(root, "src/new-core/adapter.ts"), "export {};\n");
  return root;
}

function declaration() {
  return {
    schemaVersion: 1 as const,
    kind: "RETROM_RUNTIME_NEW_CORE_CANDIDATE_V1" as const,
    branchCoreId: "new_core",
    adapterSourceModule: "src/new-core/adapter.ts",
    runtimeFiles: [{
      candidateFilename: "new-core.wasm",
      bundlePath: "runtime/new-core/new-core.wasm",
      pathInRelease: "v0.10.1/new-core.wasm",
      role: "runtime_wasm",
      maxSizeBytes: 16 << 20,
    }],
    artifact: {
      core_id: "new_core",
      runtime_family: "RPGMAKER",
      generation: "NEW_CORE",
      route_key: "NEW_CORE_WEB",
      runtime_adapter_kind: "NEW_CORE_WEB",
      adapter_id: "new-core-web",
      adapter_abi: "new-core-save",
      entry_path: "new-core.wasm",
      file_paths: ["v0.10.1/new-core.wasm"],
      requires_threads: false,
      save_payload_kind: "RUNTIME_STATE",
      save_max_bytes: 16 << 20,
      selected_for_new_bindings: true,
      available_for_launch: true,
      compatibility: {
        adapterAbi: "new-core-save",
        gameCompatibilityLine: "new-core-v1",
        readableSaveAbis: ["new-core-save-v1"],
        saveAbi: "new-core-save-v1",
      },
    },
  };
}
