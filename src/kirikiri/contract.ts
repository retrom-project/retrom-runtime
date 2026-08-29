import type { CheckpointAvailability, RuntimeState } from "../contract.js";

export type KirikiriAdapterConfig = {
  adapterKind: "KIRIKIRI2_WEB";
  adapterId: "kirikiri2-web";
  runtimeBaseUrl: string;
  projectIndexUrl: string;
  startupXp3Path: string | null;
  checkpointSlot: 1999;
};

export type KirikiriRuntimeConfig = {
  sessionId: string;
  adapter: KirikiriAdapterConfig;
};

export type KirikiriCheckpointPayload = {
  bytes: Uint8Array;
  payloadKind: "KIRIKIRI_SAVE_BUNDLE_V1";
};

export type KirikiriRuntimeEvent =
  | { type: "READY" }
  | { type: "STATE_CHANGED"; previous: RuntimeState; state: RuntimeState }
  | { type: "FATAL_ERROR"; code: string };

export interface KirikiriRuntime {
  mount(target: HTMLElement): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  checkpoint(): Promise<KirikiriCheckpointPayload>;
  screenshot(): Promise<Blob>;
  exit(): Promise<void>;
  getState(): RuntimeState;
  getCheckpointAvailability(): CheckpointAvailability;
  subscribe(listener: (event: KirikiriRuntimeEvent) => void): () => void;
}

export function validateKirikiriRuntimeConfig(config: KirikiriRuntimeConfig): void {
  const adapter = config?.adapter;
  if (!config || typeof config !== "object" || !boundedText(config.sessionId, 200) ||
    adapter?.adapterKind !== "KIRIKIRI2_WEB" || adapter.adapterId !== "kirikiri2-web" ||
    adapter.checkpointSlot !== 1999 || !validUrl(adapter.runtimeBaseUrl) ||
    !validUrl(adapter.projectIndexUrl) || !validXp3Path(adapter.startupXp3Path)) {
    throw new Error("KIRIKIRI_RUNTIME_CONFIG_INVALID");
  }
}

function validXp3Path(value: string | null) {
  return value === null || validPath(value) && value.toLowerCase().endsWith(".xp3");
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && !value.startsWith("/") &&
    !value.includes("\\") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validUrl(value: string) {
  try {return ["http:", "https:"].includes(new URL(value, globalThis.location?.origin ?? "https://runtime.invalid").protocol);}
  catch {return false;}
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
