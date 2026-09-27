import {loadCoreModule, type LoadedCoreModule} from "../provider/core-module.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {SeekableBlobSource} from "../contract.js";
import type {AssetIndexV1} from "../provider/module-api.js";
import {abi as contentAbi, contractSha256} from "../content-io/identity.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";



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
    assets: Readonly<Record<string, string>>;
  }): Promise<unknown>;
};
export type PlayLoader = (config: PlayParameters, win: Window, signal?: AbortSignal,
  content?: AdapterContentSession, report?: RuntimeProgressReporter) => Promise<LoadedCoreModule>;
export const loadPlay: PlayLoader = async (config, win, signal, session, report) => {
  if (!session || !config.assetIndex) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  return loadCoreModule({content: {contentSession: session, assetIndex: config.assetIndex},
    runtimeBaseURL: config.runtimeBaseUrl,
    assetDirectory: "assets/play/", files: ["Play.js", "Play.wasm", "play-retrom.mjs"],
    entry: "play-retrom.mjs", registration: "__RETROM_PLAY_CORE_MODULE_V1__", maximum: 128 * 1024 * 1024, window: win, signal, report});
};

export function validPlayModule(value: unknown): value is PlayModule {
  if (!value || typeof value !== "object") {return false;}
  const module = value as Partial<PlayModule>;
  return module.RETROM_PLAY_ABI === "play-host-v3" && module.contentAbi === contentAbi && module.contractSha256 === contractSha256 && module.RETROM_PLAY_CHECKPOINT_MAX_BYTES === 268435456 &&
    typeof module.createRetromPlay === "function";
}

export function validPlayCore(value: unknown): value is PlayCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<PlayCore>;
  return core.canvas?.tagName === "CANVAS" && [core.checkpoint, core.frameCount, core.pause, core.resume,
    core.screenshot, core.stop].every(method => typeof method === "function");
}
