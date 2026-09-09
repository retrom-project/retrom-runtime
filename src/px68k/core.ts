import {fetchFile, type FileSource} from "./files.js";
import type {AssetIndexV1} from "../provider/module-api.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type Px68kParameters = {
  game: FileSource; bios: (FileSource & {logicalName: string})[]; runtimeBaseUrl: string; assetIndex: AssetIndexV1;
};
export type Px68kCore = {
  HEAPU8: Uint8Array; HEAP16: Int16Array;
  FS: {mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array};
  _malloc(size: number): number; _free(pointer: number): void;
  _retrom_abi(): number; _retrom_load(path: number): number; _retrom_ready(): number;
  _retrom_step(pad0: number, pad1: number): number; _retrom_key(key: number, pressed: number): void;
  _retrom_pixels(): number; _retrom_width(): number; _retrom_height(): number; _retrom_fps(): number;
  _retrom_audio(): number; _retrom_audio_count(): number; _retrom_stop(): void;
  _retrom_state(): number; _retrom_state_size(): number; _retrom_restore(pointer: number, size: number): number;
};
export type ModuleLoader = (url: string) => Promise<unknown>;
export async function loadCore(config: Px68kParameters, progress: RuntimeProgressReporter, signal?: AbortSignal,
  loader: ModuleLoader = (url) => import(/* webpackIgnore: true */ /* @vite-ignore */ url)) {
  const base = new URL(config.runtimeBaseUrl, window.location.href);
  const assets = ["px68k-retrom.mjs", "px68k-retrom.wasm"].map((name) => {
    const path = `assets/px68k/${name}`, info = config.assetIndex[path];
    if (!info) {throw new Error("PX68K_ASSET_MISSING");}
    return {...info, url: new URL(path, base).href};
  });
  const extension = /\.(dim|xdf|hdf)$/iu.exec(decodeURIComponent(new URL(config.game.url, base).pathname))?.[1].toLowerCase();
  if (!extension) {throw new Error("PX68K_DISK_FORMAT_UNSUPPORTED");}
  const bios = ["iplrom.dat", "cgrom.dat"].map((name) => {
    const file = config.bios.find((item) => item.logicalName === name);
    if (!file) {throw new Error("PX68K_BIOS_MISSING");} return file;
  });
  const sources = [config.game, ...bios, ...assets];
  const loaded = sources.map(() => 0), total = sources.reduce((sum, item) => sum + item.sizeBytes, 0);
  progress({phase: "PROJECT_CONTENT", loadedBytes: 0, totalBytes: total});
  const bytes = await Promise.all(sources.map((source, index) => fetchFile(source, (size) => {
    loaded[index] = size; progress({phase: "PROJECT_CONTENT", loadedBytes: loaded.reduce((a, b) => a + b, 0), totalBytes: total});
  }, signal)));
  const module = await loader(assets[0].url);
  if (!module || typeof module !== "object" || !("default" in module) || typeof module.default !== "function") {
    throw new Error("PX68K_CORE_ABI_MISMATCH");
  }
  signal?.throwIfAborted();
  const value: unknown = await module.default({wasmBinary: bytes[4], print: () => undefined, printErr: () => undefined});
  if (!validCore(value)) {throw new Error("PX68K_CORE_ABI_MISMATCH");}
  const core = value, disk = `disk0.${extension}`;
  core.FS.mkdirTree("/game/keropi");
  core.FS.writeFile(`/game/${disk}`, bytes[0]);
  core.FS.writeFile("/game/keropi/iplrom.dat", bytes[1]);
  core.FS.writeFile("/game/keropi/cgrom.dat", bytes[2]);
  return {core, disk};
}
function validCore(value: unknown): value is Px68kCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<Px68kCore>;
  const methods: (keyof Px68kCore)[] = ["_malloc", "_free", "_retrom_abi", "_retrom_load", "_retrom_ready", "_retrom_step", "_retrom_key",
    "_retrom_pixels", "_retrom_width", "_retrom_height", "_retrom_fps", "_retrom_audio", "_retrom_audio_count", "_retrom_stop",
    "_retrom_state", "_retrom_state_size", "_retrom_restore"];
  return ArrayBuffer.isView(core.HEAPU8) && ArrayBuffer.isView(core.HEAP16) && !!core.FS &&
    [core.FS.mkdirTree, core.FS.writeFile, core.FS.readFile].every((method) => typeof method === "function") &&
    methods.every((key) => typeof core[key] === "function") && core._retrom_abi?.() === 1;
}
export function withBytes<T>(core: Px68kCore, bytes: Uint8Array, use: (pointer: number) => T): T {
  const pointer = core._malloc(bytes.length);
  if (!pointer) {throw new Error("PX68K_ALLOCATION_FAILED");}
  try {core.HEAPU8.set(bytes, pointer); return use(pointer);} finally {core._free(pointer);}
}
