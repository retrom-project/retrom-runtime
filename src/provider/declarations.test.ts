import { describe, expect, it } from "vitest";

import { projectProviderManifest } from "./manifest.js";
import { retromRuntimeProviderDefinition } from "../providers/retrom-runtime/catalog.js";

const targetIds = [
  "butterscotch-gamemaker",
  "kirikiri2-kag",
  "onscripter-yuri",
  "rpgmaker-2000",
  "rpgmaker-2003",
  "rpgmaker-mv",
  "rpgmaker-mz",
  "rpgmaker-vx",
  "rpgmaker-vx-ace",
  "rpgmaker-xp",
  "tyranoscript",
  "wasm4",
];

describe("retrom-runtime provider declarations", () => {
  it("declares the complete 0.12.0 target closure in one source", () => {
    expect(retromRuntimeProviderDefinition.providerVersion).toBe("0.12.0");
    expect(retromRuntimeProviderDefinition.targets.map((target) => target.id)).toEqual(targetIds);
    expect(retromRuntimeProviderDefinition.adapters).toHaveLength(8);
  });

  it("projects a public manifest without internal adapter identities", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    expect(manifest).toMatchObject({
      clientModulePath: "client.mjs",
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.12.0",
      schemaVersion: 1,
    });
    expect(manifest.targets.map((target) => target.id)).toEqual(targetIds);
    for (const target of manifest.targets) {
      expect(Object.keys(target).sort()).toEqual([
        "assetPaths",
        "capabilities",
        "checkpoint",
        "displayName",
        "gameCompatibilityLine",
        "id",
        "inputs",
        "netplayCompatibilityLine",
        "optionsKind",
      ]);
      expect(target).not.toHaveProperty("adapterId");
      expect(target).not.toHaveProperty("adapterKind");
      expect(target).not.toHaveProperty("adapterAbi");
    }
  });

  it("keeps WASM-4 in the latest-main resource contract", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    const wasm4 = manifest.targets.find((target) => target.id === "wasm4");
    expect(wasm4).toMatchObject({
      checkpoint: {
        maxBytes: 132144,
        readFormats: ["wasm4-state-v1"],
        writeFormat: "wasm4-state-v1",
      },
      inputs: [{ cardinality: "ONE", kind: "WASM4_CART_V1", optional: false, role: "game" }],
    });
  });

  it("declares the optional EasyRPG RTP tree consumed by its generated adapter config", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    for (const id of ["rpgmaker-2000", "rpgmaker-2003"]) {
      expect(manifest.targets.find((target) => target.id === id)?.inputs).toEqual([
        {cardinality: "ONE", kind: "FILE_TREE_V1", optional: false, role: "game"},
        {cardinality: "ONE", kind: "FILE_TREE_V1", optional: true, role: "rtp"},
      ]);
    }
  });
});
