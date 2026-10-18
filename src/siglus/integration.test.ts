import {expect, it} from "vitest";
import {configureRuntime} from "../runtime/configure.js";
import {prepareRuntime} from "../runtime/prepare.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {projectProviderManifest} from "../provider/manifest.js";

const file = (name: string) => ({name, logicalKey: name, sizeBytes: 12, sha256: "a".repeat(64)});
const directory = {platformId: "siglus", defaultCoreId: "siglus", allowedCoreIds: ["siglus"]};
const fingerprints = {"retrom-runtime/siglus": "b".repeat(64)};

it("recognizes a Siglus directory and chooses an explicit CHS profile without changing original paths", () => {
  const files = ["game/Scene.pck", "game/Gameexe.dat", "game/scene.chs", "game/gameexe.chs", "game/g00/a.g01"].map(file);
  const config = configureRuntime({...directory, coreIds: ["siglus"], files});
  expect(config).toEqual({content: {kind: "SIGLUS_PROJECT", entryFile: "game/Scene.pck"},
    cores: {siglus: {options: {language: "chs"}}}});
  const prepared = prepareRuntime({directory, config, files, fingerprints});
  expect(prepared.targetId).toBe("siglus");
  expect(prepared.resources[0]).toMatchObject({kind: "FILE_TREE", entryFile: "Scene.pck",
    files: files.map(f => f.logicalKey), paths: {"game/scene.chs": "scene.chs"}});
  expect(prepared.checkpoint).toMatchObject({semantics: "GAME_SAVE", writeFormat: "siglus-save-files-v1-storage-v1"});
});

it("supports original resources, rejects incomplete CHS selection and never picks a title-specific profile", () => {
  const files = ["Other Title/Scene.pck", "Other Title/Gameexe.dat", "Other Title/scene.chs"].map(file);
  const config = configureRuntime({...directory, coreIds: ["siglus"], files});
  expect(config.cores?.siglus.options).toEqual({language: "original"});
  const translated = {...config, cores: {siglus: {options: {language: "chs"}}}};
  expect(() => prepareRuntime({directory, config: translated, files, fingerprints})).toThrow("RUNTIME_SIGLUS_TRANSLATION_MISSING");
});

it("declares bounded disk preload, standard input, native saves and explicit core assets", () => {
  const target = retromRuntimeProviderDefinition.targets.find(t => t.id === "siglus");
  expect(target).toBeDefined();
  const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
  expect(manifest.targets.find(t => t.id === "siglus")).toMatchObject({
    capabilities: {contentLoading: "ON_DEMAND_AND_PRELOAD", checkpoint: true, standardGamepad: true},
    checkpoint: {semantics: "GAME_SAVE"},
  });
  expect(target?.coreAssetPaths).toEqual(["assets/siglus/siglus.mjs", "assets/siglus/siglus_bg.wasm"]);
});
