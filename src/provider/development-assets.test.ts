import {expect, it} from "vitest";
import {validateProviderLaunchRequest} from "./module-api.js";
import {emulatorJsProviderDefinition} from "../providers/emulatorjs/catalog.js";
import {launchEnvelope} from "../../tests/emulatorjs-provider-fixtures.js";

it("binds development asset URLs to the requested module revision", () => {
  const envelope = launchEnvelope();
  const base = `${envelope.runtime.runtimeBaseUrl}dev/${envelope.runtime.moduleSha256}/`;
  envelope.runtime.runtimeBaseUrl = base;
  envelope.runtime.moduleUrl = `${base}client.mjs`;
  expect(validateProviderLaunchRequest(envelope, emulatorJsProviderDefinition)).toBe(envelope);
  envelope.runtime.runtimeBaseUrl = base.replace(envelope.runtime.moduleSha256, "f".repeat(64));
  envelope.runtime.moduleUrl = `${envelope.runtime.runtimeBaseUrl}client.mjs`;
  expect(() => validateProviderLaunchRequest(envelope, emulatorJsProviderDefinition)).toThrow("PROVIDER_LAUNCH_REQUEST_INVALID");
});
