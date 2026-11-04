import {expect, it} from "vitest";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {projectProviderManifest} from "../provider/manifest.js";

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
