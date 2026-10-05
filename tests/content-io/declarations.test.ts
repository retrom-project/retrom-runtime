import golden from "./public-manifests.golden.json" with {type: "json"};
import {expect, it} from "vitest";
import {emulatorJsProviderDefinition} from "../../src/providers/emulatorjs/catalog.js";
import {retromRuntimeProviderDefinition} from "../../src/providers/retrom-runtime/catalog.js";
import {projectProviderManifest} from "../../src/provider/manifest.js";
import {defineTarget} from "../../src/provider/declarations.js";
it("[PK-01] CONTRACT/private-policies covers every input role and publishes only public capabilities", () => {
  for (const provider of [emulatorJsProviderDefinition, retromRuntimeProviderDefinition]) {
    for (const target of provider.targets) {
      expect(Object.keys(target.contentIO).sort()).toEqual(target.inputs.map((input) => input.role).sort());
      expect(() => defineTarget({...target, contentIO: {}})).toThrow();
    }
    const manifest = projectProviderManifest(provider);
    const expected = golden.find(entry => entry.providerId === provider.providerId);
    expect(manifest).toEqual(expected);
    expect(JSON.stringify(manifest)).not.toContain("contentIO");
    expect(JSON.stringify(manifest)).not.toContain("boundaryId");
    expect(JSON.stringify(manifest)).toContain("maxFileBytes");
  }
});
