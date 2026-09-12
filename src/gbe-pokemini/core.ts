import type {AssetIndexV1} from "../provider/module-api.js";
import {fetchFile, type FileSource} from "./files.js";
export type GBEParameters = {game: FileSource; bios: (FileSource & {logicalName: string})[];
  runtimeBaseUrl: string; assetIndex: AssetIndexV1};
export type GBECore = {
  FS: {writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void};
  _retrom_init(): number; _retrom_is_ready(): number; _retrom_frame_count(): number;
  _retrom_key(key: number, value: number): void; _retrom_pause(value: number): void;
  _retrom_save(): number; _retrom_restore(): number; _retrom_stop(): void; _retrom_volume(value: number): void;
};
export type CoreLoader = (config: GBEParameters, win: Window, canvas: HTMLCanvasElement, signal?: AbortSignal) => Promise<GBECore>;
export const loadCore: CoreLoader = async (config, win, canvas, signal) => {
  const base = new URL("assets/gbe_plus/", new URL(config.runtimeBaseUrl, win.document.baseURI));
  const files = new Map<string, Uint8Array>();
  for (const name of ["gbe-pokemini.mjs", "gbe-pokemini.wasm", "gbe-pokemini-register.mjs"]) {
    const asset = config.assetIndex[`assets/gbe_plus/${name}`];
    if (!asset) {throw new Error("GBE_ASSET_MISSING");}
    files.set(name, await fetchFile({url: new URL(name, base).href, ...asset}, () => undefined, signal));
  }
  const factory = await loadFactory(win, new URL("gbe-pokemini-register.mjs", base).href, signal);
  signal?.throwIfAborted();
  const value: unknown = await factory({canvas, wasmBinary: files.get("gbe-pokemini.wasm"),
    print: () => undefined, printErr: () => undefined});
  if (!validCore(value)) {throw new Error("GBE_ABI_MISMATCH");}
  return value;
};
function validCore(value: unknown): value is GBECore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<GBECore>;
  return !!core.FS && [core.FS.writeFile, core.FS.readFile, core.FS.unlink, core._retrom_init, core._retrom_is_ready,
    core._retrom_frame_count, core._retrom_key, core._retrom_pause, core._retrom_save, core._retrom_restore,
    core._retrom_stop, core._retrom_volume].every(method => typeof method === "function");
}
function loadFactory(win: Window, url: string, signal?: AbortSignal): Promise<(options: unknown) => Promise<unknown>> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const script = win.document.createElement("script"); script.type = "module"; script.src = url;
    const cleanup = () => {win.clearTimeout(timer); signal?.removeEventListener("abort", abort); script.remove();};
    const fail = () => {cleanup(); reject(new Error("GBE_MODULE_LOAD_FAILED"));};
    const abort = () => {cleanup(); reject(new Error("GBE_RUNTIME_EXITED"));};
    const timer = win.setTimeout(fail, 30000);
    script.addEventListener("error", fail, {once: true});
    script.addEventListener("load", () => {
      const value = (win as unknown as Record<string, unknown>).__RETROM_GBE_POKEMINI_FACTORY_V1__;
      if (typeof value !== "function") {fail(); return;}
      cleanup(); resolve(value as (options: unknown) => Promise<unknown>);
    }, {once: true});
    signal?.addEventListener("abort", abort, {once: true}); win.document.head.append(script);
  });
}
