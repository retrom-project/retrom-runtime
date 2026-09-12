import type {PSPSource} from "./content.js";
import type {AssetIndexV1} from "../provider/module-api.js";
import {loadPSPFile} from "./content.js";

export type PSPParameters = {
  game: PSPSource;
  runtimeBaseUrl: string;
  assetIndex?: AssetIndexV1;
};
export type PSPCore = {
  canvas: HTMLCanvasElement;
  checkpoint(): Promise<Uint8Array>;
  frameCount(): number;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  stop(): Promise<void>;
  setVolume(value: number): void;
};
export type PSPModule = {
  abi: string;
  createPPSSPPHost(options: {
    file: Blob;
    extension: string;
    restore: Uint8Array | null;
    target: HTMLElement;
    onFailure: (error: Error) => void;
    signal?: AbortSignal;
  }): Promise<unknown>;
};
export type PSPLoader = (config: PSPParameters, win: Window, signal?: AbortSignal) => Promise<unknown>;
const registration = "__RETROM_PPSSPP_V1__";

export const loadPSP: PSPLoader = async (config, win, signal) => {
  const base = new URL(config.runtimeBaseUrl, window.location.href);
  const files = ["ppsspp.js", "ppsspp.wasm", "ppsspp.data", "ppsspp.worker.mjs", "ppsspp-host.mjs", "ppsspp-input.mjs", "ppsspp-audio.mjs"];
  for (const file of files) {
    const identity = config.assetIndex?.[`assets/ppsspp/${file}`];
    if (!identity) {throw new Error("PPSSPP_ASSET_MISSING");}
    if (!Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes < 1 || identity.sizeBytes > 128 * 1024 * 1024) {
      throw new Error("PPSSPP_ASSET_SIZE_INVALID");
    }
    await loadPSPFile({url: new URL(file, base).href, sizeBytes: identity.sizeBytes, sha256: identity.sha256},
      () => undefined, null, signal);
  }
  signal?.throwIfAborted();
  const url = new URL("ppsspp-host.mjs", base).href;
  if (win === window) {return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<unknown>;}
  return new Promise<unknown>((resolve, reject) => {
    const global = win as unknown as Record<string, unknown>;
    const script = win.document.createElement("script");
    script.type = "module"; script.src = url;
    const cleanup = () => {win.clearTimeout(timeout); signal?.removeEventListener("abort", abort); script.remove();};
    const fail = () => {cleanup(); reject(new Error("PPSSPP_CORE_LOAD_FAILED"));};
    const abort = () => {cleanup(); reject(new Error("PPSSPP_RUNTIME_EXITED"));};
    const timeout = win.setTimeout(fail, 30000);
    script.addEventListener("error", fail, {once: true});
    script.addEventListener("load", () => {cleanup(); resolve(global[registration]);}, {once: true});
    signal?.addEventListener("abort", abort, {once: true});
    win.document.head.append(script);
  });
};

export function validPSPModule(value: unknown): value is PSPModule {
  if (!value || typeof value !== "object") {return false;}
  const module = value as Partial<PSPModule>;
  return module.abi === "ppsspp-host-v1" && typeof module.createPPSSPPHost === "function";
}

export function validPSPCore(value: unknown): value is PSPCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<PSPCore>;
  return core.canvas?.tagName === "CANVAS" && [core.checkpoint, core.frameCount, core.pause, core.resume,
    core.screenshot, core.stop, core.setVolume].every(method => typeof method === "function");
}
