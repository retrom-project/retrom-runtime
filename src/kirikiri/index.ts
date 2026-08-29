import { mountKirikiri2 } from "./adapter.js";
import { decodeKirikiriCheckpoint, encodeKirikiriCheckpoint, kirikiriCheckpointMagic } from "./checkpoint.js";
import { validateKirikiriRuntimeConfig, type KirikiriRuntimeConfig } from "./contract.js";
import { KirikiriRuntimeController } from "./controller.js";

export type KirikiriRuntimeOptions = {
  frameWindow: Window;
  restorePayload: Uint8Array | null;
  signal?: AbortSignal;
};

export function createKirikiriRuntime(config: KirikiriRuntimeConfig, options: KirikiriRuntimeOptions) {
  validateKirikiriRuntimeConfig(config);
  return new KirikiriRuntimeController(
    (target) => mountKirikiri2(config, target, options.frameWindow, options.restorePayload),
    options.signal ?? null,
  );
}

export type {
  KirikiriAdapterConfig,
  KirikiriCheckpointPayload,
  KirikiriRuntime,
  KirikiriRuntimeConfig,
  KirikiriRuntimeEvent,
} from "./contract.js";
export { decodeKirikiriCheckpoint, encodeKirikiriCheckpoint, kirikiriCheckpointMagic };
