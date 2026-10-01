import type {AssetIndexV1} from "../../provider/module-api.js";
import {emulatorJsProviderDefinition} from "./catalog.js";

export function requireEmulatorImplementation(targetId: string, assets: AssetIndexV1) {
  const target = emulatorJsProviderDefinition.targets.find(entry => entry.id === targetId);
  if (!target) {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
  const core = assets[target.implementation.coreAssetPath];
  if (!core || core.sha256 !== target.implementation.coreSha256 || core.sizeBytes !== target.implementation.coreSizeBytes) {
    throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");
  }
  return target;
}
