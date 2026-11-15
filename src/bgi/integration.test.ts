import {expect, it} from "vitest";
import {configureRuntime} from "../runtime/configure.js";
import {prepareRuntime} from "../runtime/prepare.js";
import {runtimeCatalog} from "../runtime/catalog.js";
const file = (logicalKey: string) => ({name: logicalKey, logicalKey, sizeBytes: 128, sha256: "a".repeat(64)});
const directory = {platformId: "bgi", defaultCoreId: "ethornell", allowedCoreIds: ["ethornell"]};
it("recognizes a BGI project, preserves original archives and declares GAME_SAVE with both cache modes", () => {
  const files = ["game/system.arc", "game/data01000.arc", "game/Game.exe"].map(file);
  const config = configureRuntime({...directory, coreIds: ["ethornell"], files});
  expect(config).toEqual({content: {kind: "BGI_PROJECT", entryFile: "game/system.arc"}, cores: {ethornell: {options: {textEncoding: "cp932"}}}});
  const prepared = prepareRuntime({directory, config, files, fingerprints: {"retrom-runtime/bgi": "b".repeat(64)}});
  expect(prepared.targetId).toBe("bgi");
  expect(prepared.resources[0]).toMatchObject({kind: "FILE_TREE", entryFile: "system.arc", files: files.map(f => f.logicalKey)});
  expect(prepared.checkpoint).toMatchObject({semantics: "GAME_SAVE"});
  const target = runtimeCatalog().providers.flatMap(p => p.targets).find(t => t.id === "bgi");
  expect(target?.capabilities).toMatchObject({contentLoading: "ON_DEMAND_AND_PRELOAD", standardGamepad: true});
});
it("rejects ambiguous roots and wrong entries without relying on game names", () => {
  expect(() => configureRuntime({...directory, coreIds: ["ethornell"], files: ["a/system.arc", "b/system.arc"].map(file)})).toThrow("RUNTIME_ENTRY_REQUIRED");
  expect(() => configureRuntime({...directory, coreIds: ["ethornell"], files: ["arbitrary/data.arc"].map(file)})).toThrow();
  const files = ["SYSTEM.ARC", "Game.exe"].map(file);
  const config = configureRuntime({...directory, coreIds: ["ethornell"], files});
  expect(() => prepareRuntime({directory, config: {...config, content: {kind: "BGI_PROJECT", entryFile: "Game.exe"}},
    files, fingerprints: {"retrom-runtime/bgi": "b".repeat(64)}})).toThrow("RUNTIME_ENTRY_INVALID");
  expect(prepareRuntime({directory, config, files, fingerprints: {"retrom-runtime/bgi": "b".repeat(64)}}).targetId).toBe("bgi");
});
