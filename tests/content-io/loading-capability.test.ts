import {expect, it} from "vitest";
import {emulatorJsProviderDefinition} from "../../src/providers/emulatorjs/catalog.js";
import {retromRuntimeProviderDefinition} from "../../src/providers/retrom-runtime/catalog.js";
import {validateProviderLaunchRequest} from "../../src/provider/module-api.js";
import {wasmEnvelope} from "../provider-fixtures.js";
import {projectProviderManifest} from "../../src/provider/manifest.js";

it.each([
  ["rpgmaker-mv", "ON_DEMAND_AND_PRELOAD"],
  ["rpgmaker-mz", "ON_DEMAND_AND_PRELOAD"],
  ["tyranoscript", "ON_DEMAND_AND_PRELOAD"],
  ["onscripter-yuri", "ON_DEMAND_AND_PRELOAD"],
  ["fake08", "PRELOAD_ONLY"],
  ["flash-ruffle", "PRELOAD_ONLY"],
  ["rpgmaker-2000", undefined],
  ["rpgmaker-2003", undefined],
  ["j2me", undefined],
])("publishes the actual game loading capability for %s", (id, capability) => {
  const target = projectProviderManifest(retromRuntimeProviderDefinition).targets.find(target => target.id === id);
  expect(target).toBeDefined();
  expect(Reflect.get(target!.capabilities, "contentLoading")).toBe(capability);
});

it.each([
  ["dosbox-pure", "ON_DEMAND_AND_PRELOAD"],
  ["puae", "PRELOAD_ONLY"],
  ["mgba", undefined],
])("uses the same capability projection for EmulatorJS %s", (id, capability) => {
  const target = projectProviderManifest(emulatorJsProviderDefinition).targets.find(target => target.id === id);
  expect(target).toBeDefined();
  expect(Reflect.get(target!.capabilities, "contentLoading")).toBe(capability);
});

it("rejects a Host envelope that changes the loading capability of the bound Target", () => {
  const envelope = wasmEnvelope();
  expect(() => validateProviderLaunchRequest(envelope, retromRuntimeProviderDefinition)).not.toThrow();
  envelope.runtime.capabilities.contentLoading = "ON_DEMAND_AND_PRELOAD";
  expect(() => validateProviderLaunchRequest(envelope, retromRuntimeProviderDefinition)).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
  delete envelope.runtime.capabilities.contentLoading;
  expect(() => validateProviderLaunchRequest(envelope, retromRuntimeProviderDefinition)).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
});
