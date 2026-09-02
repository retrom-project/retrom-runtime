import {
  validateProviderLaunchRequest,
  type AssetIndexV1,
  type RuntimeHostV1,
} from "../../provider/module-api.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

declare const __RETROM_PROVIDER_ASSET_INDEX__: AssetIndexV1;
declare const __RETROM_PROVIDER_TARGET_DIGESTS__: Readonly<Record<string, string>>;

export const providerId = emulatorJsProviderDefinition.providerId;
export const providerVersion = emulatorJsProviderDefinition.providerVersion;
export const providerApiVersion = 1 as const;

export function validateLaunchRequest(value: unknown) {
  return validateProviderLaunchRequest(value, emulatorJsProviderDefinition, embeddedTargetDigests());
}

export async function createRuntime(value: unknown, host: RuntimeHostV1) {
  return createEmulatorJsPlayer(validateLaunchRequest(value), host, embeddedAssetIndex());
}

function embeddedAssetIndex(): AssetIndexV1 {
  return typeof __RETROM_PROVIDER_ASSET_INDEX__ === "undefined" ? {} : __RETROM_PROVIDER_ASSET_INDEX__;
}


function embeddedTargetDigests() {
  return typeof __RETROM_PROVIDER_TARGET_DIGESTS__ === "undefined" ? {} : __RETROM_PROVIDER_TARGET_DIGESTS__;
}
