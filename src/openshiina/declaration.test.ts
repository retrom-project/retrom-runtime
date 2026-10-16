import {describe, expect, it} from "vitest";
import {configureRuntime, runtimeCatalog} from "../runtime/index.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
describe("Shiina target admission", () => {
  it("declares native game saves, a bounded Range policy and a complete engine fingerprint", () => {
    const target = retromRuntimeProviderDefinition.targets.find(t => t.id === "shiina-rio");
    expect(target).toBeDefined();
    expect(target!.contentIO.game).toMatchObject({mode: "RANGE", result: "READER"});
    expect(target!.coreAssetPaths).toContain("assets/openshiina/web/_framework/dotnet.native.wasm");
    const adapter = retromRuntimeProviderDefinition.adapters.find(a => a.id === target!.adapterId)!;
    expect(adapter.checkpoint).toMatchObject({semantics: "GAME_SAVE", writeFormat: "shiina-game-save-v1-storage-v1"});
    expect(adapter.capabilities.standardGamepad).toBe(true);
  });
  it("binds the platform explicitly and keeps nested game files under the selected engine INI", () => {
    expect(runtimeCatalog().bindings.find(b => b.platformIds.includes("shiina"))).toMatchObject({coreId: "openshiina", targetId: "shiina-rio"});
    const files = ["Game/RIO.INI", "Game/SJS_S.WAR", "Game/SJS.exe", "Game/mv/op.mpg"].map(logicalKey =>
      ({logicalKey, name: logicalKey, sha256: "a".repeat(64), sizeBytes: 17}));
    expect(configureRuntime({platformId: "shiina", coreIds: ["openshiina"], files}).content).toEqual({kind: "SHIINA_PROJECT", entryFile: "Game/RIO.INI"});
  });
});
