import {
  validateProviderLaunchRequest,
  validateRuntimeHost,
  type AssetIndexV1,
  type RuntimeHostV1,
} from "../../provider/module-api.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

declare const __RETROM_PROVIDER_ASSET_INDEX__: AssetIndexV1;

export const providerId = emulatorJsProviderDefinition.providerId;
export const providerVersion = emulatorJsProviderDefinition.providerVersion;
export const providerApiVersion = 1 as const;

export function validateLaunchRequest(value: unknown) {
  return validateProviderLaunchRequest(value, emulatorJsProviderDefinition);
}

export async function createRuntime(value: unknown, host: RuntimeHostV1) {
  return createEmulatorJsPlayer(validateLaunchRequest(value), validateRuntimeHost(host), embeddedAssetIndex());
}

function embeddedAssetIndex(): AssetIndexV1 {
  return typeof __RETROM_PROVIDER_ASSET_INDEX__ === "undefined" ? {} : __RETROM_PROVIDER_ASSET_INDEX__;
}
