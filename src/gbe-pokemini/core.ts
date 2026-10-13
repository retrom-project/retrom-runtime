import {importVerifiedFrameModule} from "../provider/verified-module.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
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
export type CoreLoader = (config: GBEParameters, win: Window, canvas: HTMLCanvasElement, signal?: AbortSignal, session?: AdapterContentSession) => Promise<GBECore>;
export const loadCore: CoreLoader = async (config, win, canvas, signal, session) => {
  const base = new URL("assets/gbe_plus/", new URL(config.runtimeBaseUrl, win.document.baseURI));
  const files = new Map<string, Uint8Array>();
  for (const name of ["gbe-pokemini.mjs", "gbe-pokemini.wasm"]) {
    const asset = config.assetIndex[`assets/gbe_plus/${name}`];
    if (!asset) {throw new Error("GBE_ASSET_MISSING");}
    files.set(name, await fetchFile({url: new URL(name, base).href, ...asset}, () => undefined, signal, session, "CORE_ASSET"));
  }
  const module = await importVerifiedFrameModule(win, files.get("gbe-pokemini.mjs")!, signal);
  if (!module || typeof module !== "object" || !("default" in module) || typeof module.default !== "function") {
    throw new Error("PROVIDER_CORE_ABI_MISMATCH");
  }
  const factory = module.default;
  signal?.throwIfAborted();
  const value: unknown = await factory({canvas, wasmBinary: files.get("gbe-pokemini.wasm"),
    locateFile: (path: string) => new URL(path, base).href,
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
