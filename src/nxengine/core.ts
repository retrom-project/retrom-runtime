import {sha256} from "@noble/hashes/sha2.js";
import {loadProject, fetchContent} from "./project.js";
import {isSaveName} from "./save.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {AssetIndexV1} from "../provider/module-api.js";
export type NXEngineParameters = {projectIndexUrl: string; contentDigest: string; runtimeBaseUrl: string; assetIndex: AssetIndexV1};
export type NXEngineCore = {
  HEAPU8: Uint8Array; HEAP16: Int16Array;
  FS: {mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array): void;
    readFile(path: string): Uint8Array; readdir(path: string): string[]; stat(path: string): {size: number}};
  _malloc(size: number): number; _free(pointer: number): void;
  _retrom_abi(): number; _retrom_load(path: number): number; _retrom_ready(): number;
  _retrom_step(pad0: number, pad1: number): number; _retrom_key(key: number, pressed: number): void;
  _retrom_pixels(): number; _retrom_width(): number; _retrom_height(): number; _retrom_fps(): number;
  _retrom_audio(): number; _retrom_audio_count(): number; _retrom_stop(): void;
};
export type ModuleLoader = (url: string) => Promise<unknown>;
export async function loadCore(config: NXEngineParameters, progress: RuntimeProgressReporter, signal?: AbortSignal,
  loader: ModuleLoader = (url) => import(/* webpackIgnore: true */ /* @vite-ignore */ url)) {
  const base = new URL(config.runtimeBaseUrl, window.location.href);
  const assets = ["nxengine-retrom.mjs", "nxengine-retrom.wasm"].map((name) => {
    const info = config.assetIndex[`assets/nxengine/${name}`];
    if (!info || info.sizeBytes > 32 * 1024 * 1024) {throw new Error("NXENGINE_ASSET_MISSING");}
    return {...info, url: new URL(name, base).href};
  });
  const bytes = await Promise.all(assets.map(async (asset) => {
    const data = await fetchContent(asset, () => undefined, signal);
    if (Array.from(sha256(data), (b) => b.toString(16).padStart(2, "0")).join("") !== asset.sha256) {
      throw new Error("NXENGINE_ASSET_INVALID");
    }
    return data;
  }));
  const files = await loadProject(config.projectIndexUrl, progress, signal);
  const module = await loader(assets[0].url);
  if (!module || typeof module !== "object" || !("default" in module) || typeof module.default !== "function") {
    throw new Error("NXENGINE_CORE_ABI_MISMATCH");
  }
  signal?.throwIfAborted();
  const value: unknown = await module.default({wasmBinary: bytes[1]});
  if (!validCore(value)) {throw new Error("NXENGINE_CORE_ABI_MISMATCH");}
  const core = value;
  try {
    core.FS.mkdirTree("/game"); core.FS.mkdirTree("/save");
    for (const file of files) {
      // Upstream copies bundled profiles into its save directory during startup.
      // Only an explicitly selected host checkpoint may seed native progress.
      if (isSaveName(file.path.toLowerCase())) {continue;}
      const path = file.path.toLowerCase() === "doukutsu.exe" ? "Doukutsu.exe" : file.path;
      core.FS.mkdirTree(`/game/${path.split("/").slice(0, -1).join("/")}`);
      core.FS.writeFile(`/game/${path}`, file.bytes);
    }
    signal?.throwIfAborted(); return core;
  } catch (error) {core._retrom_stop(); throw error;}
}
function validCore(value: unknown): value is NXEngineCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<NXEngineCore>;
  const methods: (keyof NXEngineCore)[] = ["_malloc", "_free", "_retrom_abi", "_retrom_load", "_retrom_ready", "_retrom_step", "_retrom_key",
    "_retrom_pixels", "_retrom_width", "_retrom_height", "_retrom_fps", "_retrom_audio", "_retrom_audio_count", "_retrom_stop"];
  return ArrayBuffer.isView(core.HEAPU8) && ArrayBuffer.isView(core.HEAP16) && !!core.FS &&
    [core.FS.mkdirTree, core.FS.writeFile, core.FS.readFile, core.FS.readdir, core.FS.stat].every((method) => typeof method === "function") &&
    methods.every((key) => typeof core[key] === "function") && core._retrom_abi?.() === 1;
}
export function withBytes<T>(core: NXEngineCore, bytes: Uint8Array, use: (pointer: number) => T): T {
  const pointer = core._malloc(bytes.length);
  if (!pointer) {throw new Error("NXENGINE_ALLOCATION_FAILED");}
  try {core.HEAPU8.set(bytes, pointer); return use(pointer);} finally {core._free(pointer);}
}
