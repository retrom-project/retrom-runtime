import { describe, expect, it } from "vitest";

import { projectProviderManifest } from "./manifest.js";
import { retromRuntimeProviderDefinition } from "../providers/retrom-runtime/catalog.js";

const targetIds = [
  "butterscotch-gamemaker",
  "j2me",
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
const sameOriginFrameTargetIds = [
  "butterscotch-gamemaker",
  "j2me",
  "kirikiri2-kag",
  "onscripter-yuri",
  "rpgmaker-2000",
  "rpgmaker-2003",
  "rpgmaker-vx",
  "rpgmaker-vx-ace",
  "rpgmaker-xp",
  "wasm4",
];

describe("retrom-runtime provider declarations", () => {
  it("declares the complete 0.17.0-dev.11 target closure in one source", () => {
    expect(retromRuntimeProviderDefinition.providerVersion).toBe("0.17.0-dev.11");
    expect(retromRuntimeProviderDefinition.targets.map((target) => target.id)).toEqual(targetIds);
    expect(retromRuntimeProviderDefinition.adapters).toHaveLength(9);
  });

  it("projects a public manifest without internal adapter identities", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    expect(manifest).toMatchObject({
      clientModulePath: "client.mjs",
      providerApiVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.17.0-dev.11",
      schemaVersion: 1,
    });
    expect(manifest.targets.map((target) => target.id)).toEqual(targetIds);
    for (const target of manifest.targets) {
      expect(Object.keys(target).sort()).toEqual([
        "assetPaths",
        "capabilities",
        "checkpoint",
        "displayName",
        "id",
        "inputs",
        "targetOptionsSchema",
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
      inputs: [{ cardinality: "ONE", kind: "WASM4_CART", optional: false, role: "game" }],
      targetOptionsSchema: {
        additionalProperties: false,
        properties: {},
        required: [],
        type: "object",
      },
    });
  });

  it("declares the optional EasyRPG RTP tree consumed by its generated adapter config", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    for (const id of ["rpgmaker-2000", "rpgmaker-2003"]) {
      expect(manifest.targets.find((target) => target.id === id)?.inputs).toEqual([
        {cardinality: "ONE", kind: "FILE_TREE", optional: false, role: "game"},
        {cardinality: "ONE", kind: "FILE_TREE", optional: true, role: "rtp"},
      ]);
    }
  });

  it("isolates every provider-owned DOM runtime in a same-origin frame", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    for (const id of sameOriginFrameTargetIds) {
      expect(manifest.targets.find((target) => target.id === id)?.capabilities.frameMode, id)
        .toBe("SAME_ORIGIN_BLANK");
    }
    for (const id of ["rpgmaker-mv", "rpgmaker-mz", "tyranoscript"]) {
      expect(manifest.targets.find((target) => target.id === id)?.capabilities.frameMode, id)
        .toBe("ISOLATED_ORIGIN_RESOURCE");
    }
  });

  it("keeps semantic kinds and profiles free of structural version suffixes", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    for (const target of manifest.targets) {
      expect(target).not.toHaveProperty("optionsKind");
      for (const input of target.inputs) {
        expect(input.kind).not.toMatch(/_V[0-9]+$/u);
      }
    }
  });
});
