import { validateRuntimeConfig } from "./catalog.js";
import { RpgRuntimeController } from "./controller.js";
import { mountEasyRpg } from "./easyrpg/adapter.js";
import { adaptMountedRpgAdapter, type RpgPlayerInstance } from "./internal-adapter.js";
import { mountMkxp } from "./mkxp/adapter.js";
import { mountNativeRpg } from "./native-web/adapter.js";
import type { RpgAdapterConfig, RpgRuntime, RpgRuntimeConfig } from "./contract.js";

export type {
  CheckpointAvailability,
  CheckpointPayload,
  CheckpointPayloadKind,
  CheckpointUnavailableReason,
  EasyRpgAdapterConfig,
  MkxpAdapterConfig,
  NativeWebAdapterConfig,
  RpgAdapterConfig,
  RpgGeneration,
  RpgPosition,
  RpgRuntime,
  RpgRuntimeConfig,
  RuntimeEvent,
  RuntimeState,
} from "./contract.js";
export { runtimeCatalog, validateRuntimeConfig } from "./catalog.js";
export { decodeRpgCheckpoint, encodeRpgCheckpoint, rpgCheckpointMagic } from "./checkpoint.js";
export { decodeMkxpRastate, encodeMkxpRastate, mkxpRastateEnvelopeBytes } from "./mkxp/state.js";

export type RuntimeDiagnostic = { runtime: string; message: string };

export type RpgRuntimeOptions = {
  frame: HTMLIFrameElement;
  frameWindow: Window;
  restorePayload: Uint8Array | null;
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: RuntimeDiagnostic) => void;
};

export type RpgRuntimeDescription = {
  crossOriginFrame: boolean;
  requiresThreads: boolean;
  runtimeBaseUrl: string;
};

export function describeRpgRuntime(config: RpgRuntimeConfig): RpgRuntimeDescription {
  validateRuntimeConfig(config);
  if (config.adapter.adapterKind === "NATIVE_WEB") {
    return { crossOriginFrame: true, requiresThreads: false, runtimeBaseUrl: config.adapter.uniqueOrigin };
  }
  return {
    crossOriginFrame: false,
    requiresThreads: config.adapter.adapterKind === "MKXP_LIBRETRO_WEB",
    runtimeBaseUrl: config.adapter.runtimeBaseUrl,
  };
}

export function createRpgRuntime(config: RpgRuntimeConfig, options: RpgRuntimeOptions): RpgRuntime {
  validateRuntimeConfig(config);
  return createController(config, options);
}

export async function mountRpgRuntime(
  config: RpgRuntimeConfig,
  target: HTMLElement,
  options: RpgRuntimeOptions,
): Promise<{ runtime: RpgRuntime; playerInstance: RpgPlayerInstance }> {
  const controller = createRpgRuntime(config, options) as RpgRuntimeController;
  await controller.mount(target);
  return { runtime: controller, playerInstance: controller.getPlayerInstance() };
}

function createController(config: RpgRuntimeConfig, options: RpgRuntimeOptions) {
  const mountAdapter = adapterMount(config, options);
  return new RpgRuntimeController(
    async (target) => {
      const mounted = await mountAdapter(target);
      try {return adaptMountedRpgAdapter(mounted);}
      catch (error) {await mounted.cleanup(); throw error;}
    },
    options.signal ?? null,
    config.validationPurpose,
  );
}

function adapterMount(config: RpgRuntimeConfig, options: RpgRuntimeOptions) {
  const adapter = config.adapter;
  switch (adapter.adapterKind) {
  case "EASYRPG_WEB":
    return (target: HTMLElement) => mountEasyRpg(
      withAdapter(config, adapter), target, options.frameWindow, options.restorePayload,
    );
  case "MKXP_LIBRETRO_WEB":
    return (target: HTMLElement) => mountMkxp(
      withAdapter(config, adapter), target, options.restorePayload, undefined, options.onDiagnostic,
    );
  case "NATIVE_WEB":
    return () => mountNativeRpg(withAdapter(config, adapter), options.frame, options.restorePayload);
  }
}

function withAdapter<T extends RpgAdapterConfig>(
  config: RpgRuntimeConfig,
  adapter: T,
): Omit<RpgRuntimeConfig, "adapter"> & { adapter: T } {
  return { ...config, adapter };
}
