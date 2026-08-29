import {
  runtimeAdapterDescriptor,
  validateRuntimeConfig,
  type RuntimeConfig,
} from "./catalog.js";
import { GameRuntimeController } from "./controller.js";
import { mountEasyRpg } from "./easyrpg/adapter.js";
import { mountKirikiri2 } from "./kirikiri/adapter.js";
import { mountMkxp } from "./mkxp/adapter.js";
import { mountNativeRpg } from "./native-web/adapter.js";
import { mountOnsYuri } from "./ons/adapter.js";
import type { GameRuntime } from "./contract.js";
import type { KirikiriRuntimeConfig } from "./kirikiri/contract.js";
import type { OnsRuntimeConfig } from "./ons/contract.js";
import type { RpgMakerAdapterConfig, RpgMakerRuntimeConfig } from "./rpgmaker/contract.js";

export type {
  CheckpointAvailability,
  CheckpointBlocker,
  GameRuntime,
  GameRuntimeEvent,
  RuntimeCapabilities,
  RuntimeCheckpoint,
  RuntimeLoadPhase,
  RuntimeLoadProgress,
  RuntimeState,
  RuntimeValidationProbe,
} from "./contract.js";
export type { RuntimeConfig } from "./catalog.js";
export { runtimeAdapters, validateRuntimeConfig } from "./catalog.js";
export type {
  EasyRpgAdapterConfig,
  MkxpAdapterConfig,
  NativeWebAdapterConfig,
  RpgMakerAdapterConfig,
  RpgMakerPositionV1,
  RpgMakerRuntimeConfig,
  RuntimeArchive,
} from "./rpgmaker/contract.js";
export { rpgMakerPositionProbeKind } from "./rpgmaker/contract.js";
export type { OnsAdapterConfig, OnsRuntimeConfig, OnsScriptEncoding } from "./ons/contract.js";
export type { KirikiriAdapterConfig, KirikiriRuntimeConfig } from "./kirikiri/contract.js";
export { decodeRpgCheckpoint, encodeRpgCheckpoint, rpgCheckpointMagic } from "./checkpoint.js";
export { decodeMkxpRastate, encodeMkxpRastate, mkxpRastateEnvelopeBytes } from "./mkxp/state.js";
export { decodeOnsCheckpoint, encodeOnsCheckpoint, onsCheckpointMagic } from "./ons/checkpoint.js";
export {
  decodeKirikiriCheckpoint,
  encodeKirikiriCheckpoint,
  kirikiriCheckpointMagic,
} from "./kirikiri/checkpoint.js";

export type RuntimeDiagnostic = { runtime: string; message: string };

export type RuntimeOptions = {
  frame?: HTMLIFrameElement;
  frameWindow: Window;
  restorePayload: Uint8Array | null;
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: RuntimeDiagnostic) => void;
};

export type RuntimeDescription = {
  crossOriginFrame: boolean;
  requiresThreads: boolean;
  runtimeBaseUrl: string;
};

export function describeRuntime(config: RuntimeConfig): RuntimeDescription {
  validateRuntimeConfig(config);
  const adapter = config.adapter;
  if (adapter.adapterKind === "NATIVE_WEB") {
    return { crossOriginFrame: true, requiresThreads: false, runtimeBaseUrl: adapter.uniqueOrigin };
  }
  return {
    crossOriginFrame: false,
    requiresThreads: adapter.adapterKind === "MKXP_LIBRETRO_WEB",
    runtimeBaseUrl: adapter.runtimeBaseUrl,
  };
}

export function createRuntime(config: RuntimeConfig, options: RuntimeOptions): GameRuntime {
  validateRuntimeConfig(config);
  const descriptor = runtimeAdapterDescriptor(config.adapter.adapterKind);
  return new GameRuntimeController(
    adapterMount(config, options),
    descriptor.capabilities,
    options.signal ?? null,
  );
}

export async function mountRuntime(config: RuntimeConfig, target: HTMLElement, options: RuntimeOptions) {
  const runtime = createRuntime(config, options);
  await runtime.mount(target);
  return runtime;
}

function adapterMount(config: RuntimeConfig, options: RuntimeOptions) {
  const adapter = config.adapter;
  switch (adapter.adapterKind) {
  case "EASYRPG_WEB":
    return (target: HTMLElement) => mountEasyRpg(
      withRpgAdapter(config as RpgMakerRuntimeConfig, adapter),
      target,
      options.frameWindow,
      options.restorePayload,
    );
  case "MKXP_LIBRETRO_WEB":
    return (target: HTMLElement) => mountMkxp(
      withRpgAdapter(config as RpgMakerRuntimeConfig, adapter),
      target,
      options.restorePayload,
      undefined,
      options.onDiagnostic,
    );
  case "NATIVE_WEB":
    return () => mountNativeRpg(
      withRpgAdapter(config as RpgMakerRuntimeConfig, adapter),
      requireFrame(options.frame),
      options.restorePayload,
    );
  case "ONS_YURI_WEB":
    return (target: HTMLElement) => mountOnsYuri(
      config as OnsRuntimeConfig,
      target,
      options.frameWindow,
      options.restorePayload,
    );
  case "KIRIKIRI2_WEB":
    return (target: HTMLElement) => mountKirikiri2(
      config as KirikiriRuntimeConfig,
      target,
      options.frameWindow,
      options.restorePayload,
    );
  }
}

function withRpgAdapter<T extends RpgMakerAdapterConfig>(
  config: RpgMakerRuntimeConfig,
  adapter: T,
): Omit<RpgMakerRuntimeConfig, "adapter"> & { adapter: T } {
  return { ...config, adapter };
}

function requireFrame(frame: HTMLIFrameElement | undefined) {
  if (!frame) {throw new Error("RUNTIME_CONFIG_INVALID");}
  return frame;
}
