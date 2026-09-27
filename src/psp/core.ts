import {loadCoreModule, type LoadedCoreModule} from "../provider/core-module.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
import {abi as contentAbi, contractSha256} from "../content-io/identity.js";
import type {ContentSessionClient} from "../content-io/client.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import type {SeekableBlobSource} from "../contract.js";
import type {AssetIndexV1} from "../provider/module-api.js";


export type PSPParameters = {
  game: SeekableBlobSource;
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
  contentAbi: string;
  contractSha256: string;
  createPPSSPPHost(options: {
    source: Pick<SeekableBlobSource, "sha256" | "sizeBytes">;
    content: PSPContent;
    restore: Uint8Array | null;
    target: HTMLElement;
    onFailure: (error: Error) => void;
    signal?: AbortSignal;
    assets: Readonly<Record<string, string>>;
  }): Promise<unknown>;
};
export type PSPContent = Awaited<ReturnType<ContentSessionClient["createSyncChannel"]>> & {abi: "content-io-v1"; contractSha256: string; syncClientUrl: string};
export type PSPContentOptions = {contentSession: AdapterContentSession & Pick<ContentSessionClient, "createSyncChannel">; runtimeBaseURL: string};
export type PSPLoader = (config: PSPParameters, win: Window, signal?: AbortSignal,
  content?: AdapterContentSession, report?: RuntimeProgressReporter) => Promise<LoadedCoreModule>;
export const loadPSP: PSPLoader = async (config, win, signal, session, report) => {
  if (!session || !config.assetIndex) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  return loadCoreModule({content: {contentSession: session, assetIndex: config.assetIndex},
    runtimeBaseURL: config.runtimeBaseUrl,
    assetDirectory: "assets/ppsspp/", files: ["ppsspp.js", "ppsspp.wasm", "ppsspp.data", "ppsspp.worker.mjs", "ppsspp-host.mjs"],
    entry: "ppsspp-host.mjs", registration: "__RETROM_PPSSPP_V1__", maximum: 128 * 1024 * 1024, window: win, signal, report});
};

export function validPSPModule(value: unknown): value is PSPModule {
  if (!value || typeof value !== "object") {return false;}
  const module = value as Partial<PSPModule>;
  return module.abi === "ppsspp-host-v3" && module.contentAbi === contentAbi && module.contractSha256 === contractSha256 && typeof module.createPPSSPPHost === "function";
}

export function validPSPCore(value: unknown): value is PSPCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<PSPCore>;
  return core.canvas?.tagName === "CANVAS" && [core.checkpoint, core.frameCount, core.pause, core.resume,
    core.screenshot, core.stop, core.setVolume].every(method => typeof method === "function");
}
