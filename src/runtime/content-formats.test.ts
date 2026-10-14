import {expect, it} from "vitest";
import {configureRuntime} from "./configure.js";
import {runtimeCatalog} from "./catalog.js";

it("preserves archives declared as native single-file entries while unpacking ordinary ROM containers", () => {
  const bindings = runtimeCatalog().bindings;
  expect(bindings.find(binding => binding.coreId === "supermodel")).toMatchObject({archiveExtensions: ["zip"]});
  expect(bindings.find(binding => binding.coreId === "fceumm")).not.toHaveProperty("archiveExtensions");
  expect(bindings.find(binding => binding.coreId === "onscripter_yuri")).not.toHaveProperty("archiveExtensions");
});

it("selects original Model 3 ZIPs supported by the shipped Supermodel core", () => {
  const configure = (name: string) => configureRuntime({platformId: "model3", coreIds: ["supermodel"],
    files: [{logicalKey: name, name, sizeBytes: 1024, sha256: "a".repeat(64)}]});
  expect(configure("cartridge.zip").content).toEqual({kind: "SINGLE_FILE", entryFile: "cartridge.zip"});
  expect(configure("CARTRIDGE.ZIP").content).toEqual({kind: "SINGLE_FILE", entryFile: "CARTRIDGE.ZIP"});
  expect(() => configure("disc.chd")).toThrow("RUNTIME_ENTRY_REQUIRED");
});
