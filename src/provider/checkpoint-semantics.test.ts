import {describe, expect, it} from "vitest";

import {validateProviderManifest} from "./contract.js";
import {projectProviderManifest} from "./manifest.js";
import {validateLaunchEnvelopeBoundary, validateProviderLaunchRequest} from "./module-api.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {targetEnvelope} from "../../tests/provider-fixtures.js";

describe("checkpoint restore semantics", () => {
  it("accepts explicit game saves without changing legacy instant declarations", () => {
    const legacy = projectProviderManifest(retromRuntimeProviderDefinition);
    expect(validateProviderManifest(legacy)).toEqual(legacy);
    const native = structuredClone(legacy);
    Object.assign(native.targets[0].checkpoint ?? {}, {semantics: "GAME_SAVE"});
    expect(validateProviderManifest(native)).toEqual(native);
  });

  it("rejects unknown, empty and non-string checkpoint semantics", () => {
    for (const semantics of ["", "MEMORY_COPY", null, true, 1]) {
      const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
      Object.assign(manifest.targets[0].checkpoint ?? {}, {semantics});
      expect(() => validateProviderManifest(manifest)).toThrow("PROVIDER_MANIFEST_INVALID");
    }
  });

  it("preserves native-save semantics at the envelope boundary and rejects a target mismatch", () => {
    const request = targetEnvelope("wasm4");
    Object.assign(request.runtime.checkpoint ?? {}, {semantics: "GAME_SAVE"});
    expect(validateLaunchEnvelopeBoundary(request)).toEqual(request);
    expect(() => validateProviderLaunchRequest(request, retromRuntimeProviderDefinition))
      .toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  });
});
