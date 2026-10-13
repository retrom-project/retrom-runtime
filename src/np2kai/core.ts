import {importVerifiedFrameModule} from "../provider/verified-module.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import type {AssetIndexV1} from "../provider/module-api.js";
import {loadDisk} from "./content.js";
export type NP2Core = {
  FS: {mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void};
  callMain(args: string[]): unknown;
  _retrom_is_ready(): number;
  _retrom_frame_count(): number;
  _retrom_pause(value: number): void;
  _retrom_key(key: number, value: number): void;
  _retrom_save(): number;
  _retrom_restore(): number;
  _retrom_stop(): void;
};
export type CoreParameters = {runtimeBaseUrl: string; assetIndex: AssetIndexV1};
export type CoreLoader = (config: CoreParameters, win: Window, canvas: HTMLCanvasElement, signal?: AbortSignal, session?: AdapterContentSession) => Promise<NP2Core>;
export const loadCore: CoreLoader = async (config, win, canvas, signal, session) => {
  const base = new URL(config.runtimeBaseUrl, win.document.baseURI);
  const files = new Map<string, Uint8Array>();
  for (const file of ["np2kai.mjs", "np2kai.wasm", "font.bmp"]) {
    const asset = config.assetIndex[`assets/np2kai/${file}`];
    if (!asset) {throw new Error("NP2KAI_ASSET_MISSING");}
    files.set(file, await loadDisk({url: new URL(file, base).href, ...asset}, () => undefined, session, signal, "CORE_ASSET"));
  }
  const module = await importVerifiedFrameModule(win, files.get("np2kai.mjs")!, signal);
  if (!module || typeof module !== "object" || !("default" in module) || typeof module.default !== "function") {
    throw new Error("PROVIDER_CORE_ABI_MISMATCH");
  }
  const factory = module.default;
  const value: unknown = await factory({canvas, wasmBinary: files.get("np2kai.wasm"), noInitialRun: true,
    locateFile: (path: string) => new URL(path, base).href,
    print: () => undefined, printErr: () => undefined,
    preRun: [(core: NP2Core) => {
      core.FS.mkdirTree("/emulator/np2kai");
      const font = files.get("font.bmp"); if (font) {core.FS.writeFile("/emulator/np2kai/font.bmp", font);}
    }],
  });
  if (!validCore(value)) {throw new Error("NP2KAI_ABI_MISMATCH");}
  return value;
};
function validCore(value: unknown): value is NP2Core {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<NP2Core>;
  return Boolean(core.FS) && [core.callMain, core._retrom_is_ready, core._retrom_frame_count, core._retrom_pause,
    core._retrom_key, core._retrom_save, core._retrom_restore, core._retrom_stop].every(method => typeof method === "function");
}
