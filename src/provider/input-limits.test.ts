import type {ProviderDefinition} from "./declarations.js";
import {expect, it} from "vitest";
import {projectProviderManifest} from "./manifest.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {emulatorJsProviderDefinition} from "../providers/emulatorjs/catalog.js";

it("publishes the same per-file limit enforced by Content I/O for every managed input", () => {
  for (const provider of [retromRuntimeProviderDefinition, emulatorJsProviderDefinition] as ProviderDefinition[]) {
    const manifest = projectProviderManifest(provider);
    for (const target of provider.targets) {
      for (const input of manifest.targets.find(item => item.id === target.id)!.inputs) {
        const policy = target.contentIO[input.role];
        expect(input).toHaveProperty("maxFileBytes", "maxFileBytes" in policy ? policy.maxFileBytes : null);
      }
    }
  }
});
