import type { RuntimeCapabilities } from "./contract.js";
import { validateButterscotchRuntimeConfig, type ButterscotchRuntimeConfig } from "./butterscotch/contract.js";
import { validateKirikiriRuntimeConfig, type KirikiriRuntimeConfig } from "./kirikiri/contract.js";
import { validateOnsRuntimeConfig, type OnsRuntimeConfig } from "./ons/contract.js";
import {
  rpgMakerRuntimeCatalog,
  validateRpgMakerRuntimeConfig,
} from "./rpgmaker/catalog.js";
import type { RpgMakerRuntimeConfig } from "./rpgmaker/contract.js";

export type RuntimeConfig = RpgMakerRuntimeConfig | OnsRuntimeConfig | KirikiriRuntimeConfig | ButterscotchRuntimeConfig;

type RuntimeAdapterDescriptor = {
  adapterAbi: string;
  adapterId: string;
  adapterKind: RuntimeConfig["adapter"]["adapterKind"];
  capabilities: RuntimeCapabilities;
  checkpointFormat: string;
};

const rpgCapabilities: RuntimeCapabilities = {
  checkpoint: true,
  contentSources: ["FILE_TREE_V1"],
  frameCounter: true,
  pause: true,
  screenshot: true,
  standardGamepad: true,
  validationProbes: ["rpgmaker.position.v1"],
  volume: false,
};

const nativeCapabilities: RuntimeCapabilities = {
  ...rpgCapabilities, contentSources: ["NATIVE_WEB_V1"], volume: true,
};

const mkxpCapabilities: RuntimeCapabilities = {
  ...rpgCapabilities, contentSources: ["SEEKABLE_BLOB_V1"],
};

const standardCapabilities: RuntimeCapabilities = {
  checkpoint: true,
  contentSources: ["FILE_TREE_V1"],
  frameCounter: false,
  pause: true,
  screenshot: true,
  standardGamepad: true,
  validationProbes: [],
  volume: false,
};

export const runtimeAdapters = [
  descriptor("EASYRPG_WEB", "easyrpg-web", "easyrpg-save", "easyrpg-save-bundle-v1", rpgCapabilities),
  descriptor(
    "MKXP_LIBRETRO_WEB", "mkxp-libretro-web", "mkxp-state-compact", "mkxp-state-compact-v1", mkxpCapabilities,
  ),
  descriptor("NATIVE_WEB", "native-web", "native-save", "native-save-bundle-v1", nativeCapabilities),
  descriptor("ONS_YURI_WEB", "ons-yuri-web", "ons-save", "ons-save-bundle-v1", standardCapabilities),
  descriptor(
    "KIRIKIRI2_WEB", "kirikiri2-web", "kirikiri-kag-bookmark", "kirikiri-save-bundle-v1", standardCapabilities,
  ),
  descriptor(
    "BUTTERSCOTCH_WEB", "butterscotch-web", "butterscotch-checkpoint-v1",
    "butterscotch-checkpoint-v1", standardCapabilities,
  ),
] as const satisfies readonly RuntimeAdapterDescriptor[];

export { rpgMakerRuntimeCatalog };

export function validateRuntimeConfig(config: RuntimeConfig): void {
  const adapterKind = config?.adapter?.adapterKind;
  if (adapterKind === "ONS_YURI_WEB") {validateOnsRuntimeConfig(config as OnsRuntimeConfig); return;}
  if (adapterKind === "KIRIKIRI2_WEB") {validateKirikiriRuntimeConfig(config as KirikiriRuntimeConfig); return;}
  if (adapterKind === "BUTTERSCOTCH_WEB") {
    validateButterscotchRuntimeConfig(config as ButterscotchRuntimeConfig);
    return;
  }
  validateRpgMakerRuntimeConfig(config as RpgMakerRuntimeConfig);
}

export function runtimeAdapterDescriptor(adapterKind: RuntimeConfig["adapter"]["adapterKind"]) {
  const descriptor = runtimeAdapters.find((entry) => entry.adapterKind === adapterKind);
  if (!descriptor) {throw new Error("RUNTIME_CONFIG_INVALID");}
  return descriptor;
}

function descriptor<Kind extends RuntimeAdapterDescriptor["adapterKind"]>(
  adapterKind: Kind,
  adapterId: string,
  adapterAbi: string,
  checkpointFormat: string,
  capabilities: RuntimeCapabilities,
) {
  return { adapterAbi, adapterId, adapterKind, capabilities, checkpointFormat };
}
