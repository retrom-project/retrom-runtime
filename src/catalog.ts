import type {RuntimeCapabilities, RuntimeContentSourceKind} from "./contract.js";
import { validateButterscotchRuntimeConfig, type ButterscotchRuntimeConfig } from "./butterscotch/contract.js";
import { validateKirikiriRuntimeConfig, type KirikiriRuntimeConfig } from "./kirikiri/contract.js";
import { validateOnsRuntimeConfig, type OnsRuntimeConfig } from "./ons/contract.js";
import {
  validateTyranoScriptRuntimeConfig,
  type TyranoScriptRuntimeConfig,
} from "./tyranoscript/contract.js";
import {validateRpgMakerRuntimeConfig} from "./rpgmaker/catalog.js";
import type { RpgMakerRuntimeConfig } from "./rpgmaker/contract.js";
import { validateWasm4RuntimeConfig, type Wasm4RuntimeConfig } from "./wasm4/contract.js";
import {retromRuntimeProviderDefinition} from "./providers/retrom-runtime/catalog.js";

export type RuntimeConfig = RpgMakerRuntimeConfig | OnsRuntimeConfig | KirikiriRuntimeConfig |
  ButterscotchRuntimeConfig | TyranoScriptRuntimeConfig | Wasm4RuntimeConfig;

type RuntimeAdapterDescriptor = {
  adapterAbi: string;
  adapterId: string;
  adapterKind: RuntimeConfig["adapter"]["adapterKind"];
  capabilities: RuntimeCapabilities;
  checkpointFormat: string;
};

export const runtimeAdapters: readonly RuntimeAdapterDescriptor[] =
  retromRuntimeProviderDefinition.adapters.map((adapter) => {
    const targets = retromRuntimeProviderDefinition.targets.filter((target) => target.adapterId === adapter.id);
    const contentSources = [...new Set(targets.flatMap((target) => target.inputs.map((input) => input.kind)))] as
      RuntimeContentSourceKind[];
    if (!adapter.checkpoint) {throw new Error("RUNTIME_CONFIG_INVALID");}
    return {
      adapterAbi: adapter.abi,
      adapterId: adapter.id,
      adapterKind: adapter.kind as RuntimeAdapterDescriptor["adapterKind"],
      capabilities: {...adapter.capabilities, contentSources} satisfies RuntimeCapabilities,
      checkpointFormat: adapter.checkpoint.writeFormat,
    };
  });

export function validateRuntimeConfig(config: RuntimeConfig): void {
  const adapterKind = config?.adapter?.adapterKind;
  if (adapterKind === "ONS_YURI_WEB") {validateOnsRuntimeConfig(config as OnsRuntimeConfig); return;}
  if (adapterKind === "KIRIKIRI2_WEB") {validateKirikiriRuntimeConfig(config as KirikiriRuntimeConfig); return;}
  if (adapterKind === "BUTTERSCOTCH_WEB") {
    validateButterscotchRuntimeConfig(config as ButterscotchRuntimeConfig);
    return;
  }
  if (adapterKind === "TYRANOSCRIPT_WEB") {
    validateTyranoScriptRuntimeConfig(config as TyranoScriptRuntimeConfig);
    return;
  }
  if (adapterKind === "WASM4_WEB") {validateWasm4RuntimeConfig(config as Wasm4RuntimeConfig); return;}
  validateRpgMakerRuntimeConfig(config as RpgMakerRuntimeConfig);
}

export function runtimeAdapterDescriptor(adapterKind: RuntimeConfig["adapter"]["adapterKind"]) {
  const descriptor = runtimeAdapters.find((entry) => entry.adapterKind === adapterKind);
  if (!descriptor) {throw new Error("RUNTIME_CONFIG_INVALID");}
  return descriptor;
}
