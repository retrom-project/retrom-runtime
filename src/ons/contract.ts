import type { CheckpointAvailability, RuntimeState } from "../contract.js";

export type OnsScriptEncoding = "gbk" | "sjis" | "utf8";

export type OnsAdapterConfig = {
  adapterKind: "ONS_YURI_WEB";
  adapterId: "ons-yuri-web";
  runtimeBaseUrl: string;
  projectIndexUrl: string;
  scriptEncoding: OnsScriptEncoding;
  checkpointSlot: 999;
};

export type OnsRuntimeConfig = {
  sessionId: string;
  adapter: OnsAdapterConfig;
};

export type OnsCheckpointPayload = {
  bytes: Uint8Array;
  payloadKind: "ONS_SAVE_BUNDLE_V1";
};

export type OnsRuntimeEvent =
  | { type: "READY" }
  | { type: "STATE_CHANGED"; previous: RuntimeState; state: RuntimeState }
  | { type: "FATAL_ERROR"; code: string };

export interface OnsRuntime {
  mount(target: HTMLElement): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  checkpoint(): Promise<OnsCheckpointPayload>;
  screenshot(): Promise<Blob>;
  exit(): Promise<void>;
  getState(): RuntimeState;
  getCheckpointAvailability(): CheckpointAvailability;
  subscribe(listener: (event: OnsRuntimeEvent) => void): () => void;
}

export function validateOnsRuntimeConfig(config: OnsRuntimeConfig): void {
  if (!config || typeof config !== "object" || !boundedText(config.sessionId, 200) ||
    config.adapter?.adapterKind !== "ONS_YURI_WEB" || config.adapter.adapterId !== "ons-yuri-web" ||
    config.adapter.checkpointSlot !== 999 || !validUrl(config.adapter.runtimeBaseUrl) ||
    !validUrl(config.adapter.projectIndexUrl) || !validEncoding(config.adapter.scriptEncoding)) {
    throw new Error("ONS_RUNTIME_CONFIG_INVALID");
  }
}

function validEncoding(value: unknown): value is OnsScriptEncoding {
  return value === "gbk" || value === "sjis" || value === "utf8";
}

function validUrl(value: string) {
  try {return ["http:", "https:"].includes(new URL(value, globalThis.location?.origin ?? "https://runtime.invalid").protocol);}
  catch {return false;}
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
