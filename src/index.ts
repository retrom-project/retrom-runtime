import {
  runtimeAdapterDescriptor,
  validateRuntimeConfig,
  type RuntimeConfig,
} from "./catalog.js";
import { GameRuntimeController } from "./controller.js";
import { mountButterscotch } from "./butterscotch/adapter.js";
import { mountEasyRpg } from "./easyrpg/adapter.js";
import { mountKirikiri2 } from "./kirikiri/adapter.js";
import { mountMkxp } from "./mkxp/adapter.js";
import { mountNativeRpg } from "./native-web/adapter.js";
import { mountOnsYuri } from "./ons/adapter.js";
import { mountTyranoScript } from "./tyranoscript/adapter.js";
import { mountWasm4 } from "./wasm4/adapter.js";
import type { GameRuntime } from "./contract.js";
import type { ButterscotchRuntimeConfig } from "./butterscotch/contract.js";
import type { RuntimeExitReporter, RuntimeProgressReporter } from "./internal-adapter.js";
import type { KirikiriRuntimeConfig } from "./kirikiri/contract.js";
import type { OnsRuntimeConfig } from "./ons/contract.js";
import type { TyranoScriptRuntimeConfig } from "./tyranoscript/contract.js";
import type { RpgMakerAdapterConfig, RpgMakerRuntimeConfig } from "./rpgmaker/contract.js";
import type { Wasm4RuntimeConfig } from "./wasm4/contract.js";

export type {
  CheckpointAvailability,
  CheckpointBlocker,
  FileTreeSource,
  GameRuntime,
  GameRuntimeEvent,
  RuntimeCapabilities,
  RuntimeCheckpoint,
  RuntimeContentSourceKind,
  RuntimeLoadPhase,
  RuntimeLoadProgress,
  RuntimeState,
  RuntimeValidationProbe,
  SeekableBlobSource,
} from "./contract.js";
export type { RuntimeConfig } from "./catalog.js";
export type { ButterscotchAdapterConfig, ButterscotchRuntimeConfig } from "./butterscotch/contract.js";
export { runtimeAdapters, validateRuntimeConfig } from "./catalog.js";
export type {
  EasyRpgAdapterConfig,
  MkxpAdapterConfig,
  NativeWebAdapterConfig,
  RpgMakerAdapterConfig,
  RpgMakerPositionV1,
  RpgMakerRuntimeConfig,
} from "./rpgmaker/contract.js";
export { rpgMakerPositionProbeKind } from "./rpgmaker/contract.js";
export type { OnsAdapterConfig, OnsRuntimeConfig, OnsScriptEncoding } from "./ons/contract.js";
export type { KirikiriAdapterConfig, KirikiriRuntimeConfig } from "./kirikiri/contract.js";
export type { TyranoScriptAdapterConfig, TyranoScriptRuntimeConfig } from "./tyranoscript/contract.js";
export type { Wasm4AdapterConfig, Wasm4RuntimeConfig } from "./wasm4/contract.js";
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
  if (adapter.adapterKind === "TYRANOSCRIPT_WEB") {
    return { crossOriginFrame: true, requiresThreads: false, runtimeBaseUrl: adapter.uniqueOrigin };
  }
  return {
    crossOriginFrame: false,
    requiresThreads: adapter.adapterKind === "MKXP_LIBRETRO_WEB" || adapter.adapterKind === "BUTTERSCOTCH_WEB",
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
    return (target: HTMLElement, _reportProgress: RuntimeProgressReporter, reportExitRequested: RuntimeExitReporter) => mountEasyRpg(
      withRpgAdapter(config as RpgMakerRuntimeConfig, adapter),
      target,
      options.frameWindow,
      options.restorePayload,
      reportExitRequested,
    );
  case "MKXP_LIBRETRO_WEB":
    return (target: HTMLElement, reportProgress: RuntimeProgressReporter, reportExitRequested: RuntimeExitReporter) => mountMkxp(
      withRpgAdapter(config as RpgMakerRuntimeConfig, adapter),
      target,
      options.restorePayload,
      undefined,
      options.onDiagnostic,
      reportProgress,
      reportExitRequested,
    );
  case "NATIVE_WEB":
    return (_target: HTMLElement, _reportProgress: RuntimeProgressReporter, reportExitRequested: RuntimeExitReporter) => mountNativeRpg(
      withRpgAdapter(config as RpgMakerRuntimeConfig, adapter),
      requireFrame(options.frame),
      options.restorePayload,
      reportExitRequested,
    );
  case "ONS_YURI_WEB":
    return (target: HTMLElement, reportProgress: RuntimeProgressReporter, reportExitRequested: RuntimeExitReporter) => mountOnsYuri(
      config as OnsRuntimeConfig,
      target,
      options.frameWindow,
      options.restorePayload,
      reportProgress,
      reportExitRequested,
    );
  case "KIRIKIRI2_WEB":
    return (target: HTMLElement, _reportProgress: RuntimeProgressReporter, reportExitRequested: RuntimeExitReporter) => mountKirikiri2(
      config as KirikiriRuntimeConfig,
      target,
      options.frameWindow,
      options.restorePayload,
      reportExitRequested,
    );
  case "BUTTERSCOTCH_WEB":
    return (target: HTMLElement, reportProgress: RuntimeProgressReporter, reportExitRequested: RuntimeExitReporter) => mountButterscotch(
      config as ButterscotchRuntimeConfig,
      target,
      options.frameWindow,
      options.restorePayload,
      reportProgress,
      reportExitRequested,
    );
  case "TYRANOSCRIPT_WEB":
    return (_target: HTMLElement, _reportProgress: RuntimeProgressReporter, reportExitRequested: RuntimeExitReporter) => mountTyranoScript(
      config as TyranoScriptRuntimeConfig,
      requireFrame(options.frame),
      options.restorePayload,
      reportExitRequested,
    );
  case "WASM4_WEB":
    return (target: HTMLElement, reportProgress: RuntimeProgressReporter) => mountWasm4(
      config as Wasm4RuntimeConfig,
      target,
      options.frameWindow,
      options.restorePayload,
      reportProgress,
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
