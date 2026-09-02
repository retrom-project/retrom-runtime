import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { canonicalJsonBytes, validateProviderManifest } from "./contract.js";
import { projectProviderManifest } from "./manifest.js";
import { retromRuntimeProviderDefinition } from "../providers/retrom-runtime/catalog.js";

describe("Runtime Provider V1 contract consumer", () => {
  it("vendors the complete Retrom authority without host source imports", async () => {
    const root = "contracts/retrom-provider/v1";
    const source = JSON.parse(await readFile(`${root}/SOURCE.json`, "utf8")) as {
      authorityPath: string;
      authorityRepository: string;
      contractSha256: string;
      contractVersion: string;
      files: Array<{ path: string; sha256: string }>;
      schemaVersion: number;
    };
    expect(source).toMatchObject({
      authorityPath: "api/runtime-provider/v1",
      authorityRepository: "https://github.com/retrom-project/retrom",
      contractVersion: "runtime-provider-v1",
      schemaVersion: 1,
    });
    expect((await readdir(root)).sort()).toEqual([
      "SOURCE.json",
      "common.schema.json",
      "fixtures",
      "launch-envelope.schema.json",
      "provider-integrity.schema.json",
      "provider-lock.schema.json",
      "provider-manifest.schema.json",
      "provider-module-v1.d.ts",
      "runtime-resource.schema.json",
    ]);
    for (const entry of source.files) {
      const relativePath = entry.path.replace(/^api\/runtime-provider\/v1\//u, "");
      const bytes = await readFile(`${root}/${relativePath}`);
      expect(createHash("sha256").update(bytes).digest("hex"), entry.path).toBe(entry.sha256);
    }
    expect(source.contractSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(await readFile("src/provider/generated/provider-module-v1.ts", "utf8"))
      .toBe(await readFile(`${root}/provider-module-v1.d.ts`, "utf8"));
  });

  it("accepts the generated twelve-target manifest", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    expect(validateProviderManifest(manifest)).toEqual(manifest);
  });

  it("rejects unknown fields, unsafe paths and unordered sets", () => {
    const base = projectProviderManifest(retromRuntimeProviderDefinition);
    expect(() => validateProviderManifest({...base, adapterId: "host-leak"})).toThrow(
      "PROVIDER_MANIFEST_INVALID",
    );

    const unknownTarget = structuredClone(base);
    Object.assign(unknownTarget.targets[0], {adapterAbi: "host-leak"});
    expect(() => validateProviderManifest(unknownTarget)).toThrow("PROVIDER_MANIFEST_INVALID");

    const unsafePath = structuredClone(base);
    unsafePath.targets[0].assetPaths = ["assets/../escape"];
    expect(() => validateProviderManifest(unsafePath)).toThrow("PROVIDER_MANIFEST_INVALID");

    const unordered = structuredClone(base);
    unordered.targets[0].assetPaths = ["assets/z", "assets/a"];
    expect(() => validateProviderManifest(unordered)).toThrow("PROVIDER_MANIFEST_INVALID");
  });

  it("rejects contradictory checkpoint declarations", () => {
    const base = projectProviderManifest(retromRuntimeProviderDefinition);
    const target = base.targets.find((entry) => entry.id === "wasm4");
    if (!target?.checkpoint) {throw new Error("test fixture missing WASM-4 checkpoint");}
    target.checkpoint.readFormats = ["legacy-v1"];
    expect(() => validateProviderManifest(base)).toThrow("PROVIDER_MANIFEST_INVALID");
  });

  it("canonicalizes schema-safe JSON and rejects floats", () => {
    expect(new TextDecoder().decode(canonicalJsonBytes({z: [3, 2, 1], name: "运行时", a: true}))).toBe(
      '{"a":true,"name":"运行时","z":[3,2,1]}',
    );
    expect(() => canonicalJsonBytes({unsafe: 1.5})).toThrow("PROVIDER_CANONICAL_JSON_INVALID");
  });
});
