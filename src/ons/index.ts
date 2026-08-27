import { mountOnsYuri } from "./adapter.js";
import { validateOnsRuntimeConfig, type OnsRuntimeConfig } from "./contract.js";
import { OnsRuntimeController } from "./controller.js";

export type OnsRuntimeOptions = {
  frameWindow: Window;
  restorePayload: Uint8Array | null;
  signal?: AbortSignal;
};

export function createOnsRuntime(config: OnsRuntimeConfig, options: OnsRuntimeOptions) {
  validateOnsRuntimeConfig(config);
  return new OnsRuntimeController(
    (target) => mountOnsYuri(config, target, options.frameWindow, options.restorePayload),
    options.signal ?? null,
  );
}

export type {
  OnsAdapterConfig,
  OnsCheckpointPayload,
  OnsRuntime,
  OnsRuntimeConfig,
  OnsRuntimeEvent,
  OnsScriptEncoding,
} from "./contract.js";
export { decodeOnsCheckpoint, encodeOnsCheckpoint, onsCheckpointMagic } from "./checkpoint.js";
