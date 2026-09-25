import {describe, expect, it} from "vitest";

import {validateProviderManifest} from "./contract.js";
import {projectProviderManifest} from "./manifest.js";
import {validateLaunchEnvelopeBoundary, validateProviderLaunchRequest} from "./module-api.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {emulatorJsProviderDefinition} from "../providers/emulatorjs/catalog.js";
import {targetEnvelope} from "../../tests/provider-fixtures.js";
import {defineAdapter, defineProvider} from "./declarations.js";

describe("checkpoint restore semantics", () => {
  it("keeps Daphne explicitly NO_SAVE until its content Target passes product acceptance", () => {
    const daphne = emulatorJsProviderDefinition.adapters.find((adapter) => adapter.id === "emulatorjs-daphne");
    expect(daphne).toMatchObject({saveSemantics: "NO_SAVE", checkpoint: null,
      capabilities: {checkpoint: false}});
    expect(emulatorJsProviderDefinition.targets.some((target) => target.adapterId === "emulatorjs-daphne"))
      .toBe(false);
  });
  it("projects an explicitly declared NO_SAVE target without a checkpoint contract", () => {
    const base = retromRuntimeProviderDefinition;
    const original = base.targets[0];
    const adapter = defineAdapter({
      abi: "daphne-no-save-v1", capabilities: {...base.adapters[0].capabilities, checkpoint: false},
      checkpoint: null, id: "daphne-no-save", kind: "DAPHNE", saveSemantics: "NO_SAVE",
    });
    const provider = defineProvider({...base, adapters: [...base.adapters, adapter], targets: [
      ...base.targets, {...original, adapterId: adapter.id, checkpointMaxBytes: null, id: "daphne-no-save"},
    ]});
    const manifest = projectProviderManifest(provider);
    const target = manifest.targets.find((item) => item.id === "daphne-no-save");
    expect(target?.capabilities.checkpoint).toBe(false);
    expect(target?.checkpoint).toBeNull();
    expect(validateProviderManifest(manifest)).toEqual(manifest);
    expect(() => defineAdapter({...adapter, capabilities: {...adapter.capabilities, checkpoint: true}}))
      .toThrow("PROVIDER_NO_SAVE_INVALID");
    expect(() => defineAdapter({...adapter, saveSemantics: undefined}))
      .toThrow("PROVIDER_NO_SAVE_INVALID");
  });
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
