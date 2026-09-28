// @vitest-environment node
import {expect, it} from "vitest";
import {targetCatalog} from "../../scripts/content-io/target-catalog.mjs";
import {retromRuntimeProviderDefinition} from "../../src/providers/retrom-runtime/catalog.js";
import {emulatorJsProviderDefinition} from "../../src/providers/emulatorjs/catalog.js";

it("exports all current declarations, including mixed media and explicit no-save semantics", async () => {
  const catalog = await targetCatalog();
  for (const provider of [retromRuntimeProviderDefinition, emulatorJsProviderDefinition]) {
    expect(catalog.targets.filter(row => row.providerId === provider.providerId).map(row => row.targetId).sort())
      .toEqual(provider.targets.map(target => target.id).sort());
  }
  expect(catalog.targets.find(row => row.targetId === "flycast")).toMatchObject({mode: "RANGE", delivery: "READER"});
  expect(catalog.targets.find(row => row.targetId === "daphne")).toMatchObject({gameKind: "FILE_TREE", checkpointSemantics: "NO_SAVE"});
  expect(catalog.targets.find(row => row.targetId === "butterscotch-gamemaker")).toMatchObject({mode: "RANGE", delivery: "READER"});
});
