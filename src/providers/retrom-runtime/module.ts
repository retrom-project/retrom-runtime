import {createRuntime as createLegacyRuntime} from "../../index.js";
import {
  validateProviderLaunchRequest,
  type AssetIndexV1,
  type RuntimeHostV1,
} from "../../provider/module-api.js";
import {retromRuntimeProviderDefinition} from "./catalog.js";
import {createRetromRuntimePlayer} from "./provider-runtime.js";

declare const __RETROM_PROVIDER_ASSET_INDEX__: AssetIndexV1;
declare const __RETROM_PROVIDER_TARGET_DIGESTS__: Readonly<Record<string, string>>;

export const providerId = retromRuntimeProviderDefinition.providerId;
export const providerVersion = retromRuntimeProviderDefinition.providerVersion;
export const providerApiVersion = 1 as const;

export function validateLaunchRequest(value: unknown) {
  return validateProviderLaunchRequest(value, retromRuntimeProviderDefinition, embeddedTargetDigests());
}

export async function createRuntime(value: unknown, host: RuntimeHostV1) {
  const request = validateLaunchRequest(value);
  return createRetromRuntimePlayer(request, host, embeddedAssetIndex(), createLegacyRuntime);
}

function embeddedAssetIndex(): AssetIndexV1 {
  return typeof __RETROM_PROVIDER_ASSET_INDEX__ === "undefined" ? {} : __RETROM_PROVIDER_ASSET_INDEX__;
}

function embeddedTargetDigests() {
  return typeof __RETROM_PROVIDER_TARGET_DIGESTS__ === "undefined" ? {} : __RETROM_PROVIDER_TARGET_DIGESTS__;
}
