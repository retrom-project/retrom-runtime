import type {SeekableBlobSource} from "../contract.js";
import type {AssetIndexV1} from "../provider/module-api.js";
import {abi as contentAbi, contractSha256} from "../content-io/identity.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {contentLimits} from "../content-io/limits.js";

export type PlayParameters = {
  disc: SeekableBlobSource;
  runtimeBaseUrl: string;
  assetIndex?: AssetIndexV1;
};
export type PlayCore = {
  canvas: HTMLCanvasElement;
  checkpoint(): Promise<Uint8Array>;
  frameCount(): number;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  stop(): Promise<void>;
};
export type PlayModule = {
  RETROM_PLAY_ABI: string;
  contentAbi: string;
  contractSha256: string;
  RETROM_PLAY_CHECKPOINT_MAX_BYTES: number;
  createRetromPlay(options: {
    disc: Pick<SeekableBlobSource, "sha256" | "sizeBytes">;
    content: {abi: "content-io-v1"; contractSha256: string; disc: ContentReaderV1};
    restorePayload: Uint8Array | null;
    target: HTMLElement;
    onFailure: (error: Error) => void;
    signal?: AbortSignal;
  }): Promise<unknown>;
};
export type PlayLoader = (config: PlayParameters, win: Window, signal?: AbortSignal, content?: AdapterContentSession) => Promise<unknown>;
const registration = "__RETROM_PLAY_CORE_MODULE_V1__";

export const loadPlay: PlayLoader = async (config, win, signal, content) => {
  const base = new URL(config.runtimeBaseUrl, window.location.href);
  const files = ["Play.js", "Play.wasm", "checkpoint.mjs", "input.mjs", "play-retrom.mjs", "disc-device.mjs"];
  for (const file of files) {
    const identity = config.assetIndex?.[`assets/play/${file}`];
    if (!identity) {throw new Error("PLAY_ASSET_MISSING");}
    if (!content) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
    await materializeFileBytes(content, {...identity, url: new URL(file, base).href}, eagerPolicy(contentLimits.fantasyFile), "CORE_ASSET", signal);
  }
  signal?.throwIfAborted();
  const url = new URL("play-retrom.mjs", base).href;
  if (win === window) {return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<unknown>;}
  return new Promise<unknown>((resolve, reject) => {
    const global = win as unknown as Record<string, unknown>;
    const script = win.document.createElement("script");
    script.type = "module"; script.src = url;
    const cleanup = () => {win.clearTimeout(timeout); signal?.removeEventListener("abort", abort); script.remove();};
    const fail = () => {cleanup(); reject(new Error("PLAY_CORE_LOAD_FAILED"));};
    const abort = () => {cleanup(); reject(new Error("PLAY_RUNTIME_EXITED"));};
    const timeout = win.setTimeout(fail, 30000);
    script.addEventListener("error", fail, {once: true});
    script.addEventListener("load", () => {cleanup(); resolve(global[registration]);}, {once: true});
    signal?.addEventListener("abort", abort, {once: true});
    win.document.head.append(script);
  });
};

export function validPlayModule(value: unknown): value is PlayModule {
  if (!value || typeof value !== "object") {return false;}
  const module = value as Partial<PlayModule>;
  return module.RETROM_PLAY_ABI === "play-host-v2" && module.contentAbi === contentAbi && module.contractSha256 === contractSha256 && module.RETROM_PLAY_CHECKPOINT_MAX_BYTES === 268435456 &&
    typeof module.createRetromPlay === "function";
}

export function validPlayCore(value: unknown): value is PlayCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<PlayCore>;
  return core.canvas?.tagName === "CANVAS" && [core.checkpoint, core.frameCount, core.pause, core.resume,
    core.screenshot, core.stop].every(method => typeof method === "function");
}
