import {abortable, checkSignal} from "../content-io/abort.js";
import {ContentIOError} from "../content-io/errors.js";
import type {AdapterContentOptions} from "./content-inputs.js";
import {loadCoreAsset} from "./core-assets.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";

export type LoadedCoreModule = {module: unknown; assets: Readonly<Record<string, string>>; close(): void};
type CoreModuleRequest = {
  content: AdapterContentOptions;
  runtimeBaseURL: string;
  assetDirectory: string;
  files: readonly string[];
  entry: string;
  registration: string;
  maximum: number;
  window: Window;
  signal?: AbortSignal;
  report?: RuntimeProgressReporter;
};

/** Core entry points must be self-contained modules. Every URL handed to native code owns verified bytes. */
export async function loadCoreModule(request: CoreModuleRequest): Promise<LoadedCoreModule> {
  const {content, runtimeBaseURL, assetDirectory, maximum, signal, files} = request;
  const assets: Record<string, string> = Object.create(null);
  const close = () => {for (const name of Object.keys(assets)) {URL.revokeObjectURL(assets[name]); delete assets[name];}};
  const totalBytes = files.reduce((total, name) => {
    const file = content.assetIndex[assetDirectory + name];
    if (!file || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > maximum) {
      throw new ContentIOError("SOURCE_INVALID");
    }
    return total + file.sizeBytes;
  }, 0);
  let loadedBytes = 0;
  try {
    checkSignal(signal);
    request.report?.({phase: "RUNTIME_ASSET", loadedBytes, totalBytes});
    for (const name of files) {
      const bytes = await loadCoreAsset(content, new URL(name, new URL(runtimeBaseURL, location.href)).href, assetDirectory + name, maximum, signal,
        progress => request.report?.({phase: "RUNTIME_ASSET", loadedBytes: loadedBytes + progress.readyBytes, totalBytes}));
      checkSignal(signal);
      const type = name.endsWith(".wasm") ? "application/wasm" : /\.m?js$/u.test(name) ? "text/javascript" : "application/octet-stream";
      assets[name] = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], {type}));
      loadedBytes += bytes.byteLength;
    }
    const url = assets[request.entry];
    if (!url) {throw new ContentIOError("SOURCE_INVALID");}
    const module = await importCoreModule(request.window, url, request.registration, signal);
    checkSignal(signal);
    return {module, assets, close};
  } catch (error) {close(); throw error;}
}

function importCoreModule(win: Window, url: string, registration: string, signal?: AbortSignal): Promise<unknown> {
  checkSignal(signal);
  if (win === window) {return abortable(import(/* webpackIgnore: true */ /* @vite-ignore */ url), signal);}
  return new Promise((resolve, reject) => {
    const script = win.document.createElement("script");
    script.type = "module"; script.src = url;
    const cleanup = () => {win.clearTimeout(timer); signal?.removeEventListener("abort", abort); script.remove();};
    const abort = () => {cleanup(); reject(new ContentIOError("ABORTED"));};
    const fail = () => {cleanup(); reject(new Error("PROVIDER_CORE_MODULE_LOAD_FAILED"));};
    const timer = win.setTimeout(fail, 30000);
    script.addEventListener("error", fail, {once: true});
    script.addEventListener("load", () => {cleanup(); resolve((win as unknown as Record<string, unknown>)[registration]);}, {once: true});
    signal?.addEventListener("abort", abort, {once: true});
    win.document.head.append(script);
  });
}
