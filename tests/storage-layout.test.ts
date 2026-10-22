import {expect, test} from "vitest";
import {runtimeCatalog} from "../src/runtime/catalog.js";

test("declares STORE ZIP for the fourteen project targets and preserves native file layouts", () => {
  const bindings = runtimeCatalog().bindings;
  const projects = bindings.filter(binding => binding.storageLayout === "ZIP_STORE");
  expect(projects).toHaveLength(14);
  expect([...new Set(projects.map(binding => binding.coreId))].sort()).toEqual([
    "butterscotch", "kirikiri2", "nxengine", "onscripter_yuri", "rpgmaker", "scummvm", "siglus", "tyranoscript",
  ]);
  expect(projects.filter(binding => binding.coreId === "rpgmaker")).toHaveLength(7);
  for (const coreId of ["daphne", "dosbox_pure", "fceumm", "fbneo"]) {
    const selected = bindings.filter(binding => binding.coreId === coreId);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every(binding => binding.storageLayout === "FILES")).toBe(true);
  }
});
