import type {FantasyCore} from "./state.js";
import {verifiedFetch} from "./fetch.js";
import type {AssetIndexV1} from "../provider/module-api.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type FantasyParameters = {
  core: FantasyCore; cartUrl: string; cartSizeBytes: number; contentDigest: string;
  runtimeBaseUrl: string; assetIndex: AssetIndexV1;
};
export type NativeCore = {
  HEAPU8: Uint8Array; HEAP16: Int16Array;
  _malloc(size: number): number; _free(pointer: number): void;
  _retrom_abi(): number; _retrom_ready(): number; _retrom_load(pointer: number, size: number): number;
  _retrom_step(buttons: number): number; _retrom_stop(): void;
  _retrom_pixels(): number; _retrom_audio(): number; _retrom_audio_count(): number;
  _retrom_state(): number; _retrom_state_size(): number;
  _retrom_restore(pointer: number, size: number): number;
};
export type ModuleLoader = (url: string) => Promise<unknown>;
export async function loadCore(config: FantasyParameters, progress: RuntimeProgressReporter,
  signal: AbortSignal | undefined, loader: ModuleLoader): Promise<{core: NativeCore; cart: Uint8Array}> {
  const base = new URL(config.runtimeBaseUrl, window.location.href);
  const modulePath = `assets/${config.core}/${config.core}-retrom.mjs`;
  const wasmPath = `assets/${config.core}/${config.core}-retrom.wasm`;
  const jsInfo = config.assetIndex[modulePath], wasmInfo = config.assetIndex[wasmPath];
  if (!jsInfo || !wasmInfo || config.cartSizeBytes < 1 || config.cartSizeBytes > 4 * 1024 * 1024) {
    throw new Error("FANTASY_RUNTIME_CONFIG_INVALID");
  }
  const moduleURL = new URL(modulePath, base).href;
  const [cart, wasm] = await Promise.all([
    verifiedFetch(config.cartUrl, config.cartSizeBytes, config.contentDigest, signal),
    verifiedFetch(new URL(wasmPath, base).href, wasmInfo.sizeBytes, wasmInfo.sha256, signal),
    verifiedFetch(moduleURL, jsInfo.sizeBytes, jsInfo.sha256, signal),
  ]);
  progress({phase: "PROJECT_CONTENT", loadedBytes: cart.length, totalBytes: cart.length});
  progress({phase: "RUNTIME_ASSET", loadedBytes: wasm.length + jsInfo.sizeBytes, totalBytes: wasm.length + jsInfo.sizeBytes});
  const module = await loader(moduleURL);
  if (!module || typeof module !== "object" || !("default" in module) || typeof module.default !== "function") {
    throw new Error("FANTASY_CORE_ABI_MISMATCH");
  }
  signal?.throwIfAborted();
  const core: unknown = await module.default({wasmBinary: wasm, print: () => undefined, printErr: () => undefined});
  if (!validCore(core)) {throw new Error("FANTASY_CORE_ABI_MISMATCH");}
  return {core, cart};
}
function validCore(value: unknown): value is NativeCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<NativeCore>;
  const methods: (keyof NativeCore)[] = ["_malloc", "_free", "_retrom_abi", "_retrom_load", "_retrom_step",
    "_retrom_stop", "_retrom_ready", "_retrom_pixels", "_retrom_audio", "_retrom_audio_count", "_retrom_state", "_retrom_state_size", "_retrom_restore"];
  return ArrayBuffer.isView(core.HEAPU8) && ArrayBuffer.isView(core.HEAP16) &&
    methods.every((key) => typeof core[key] === "function") && core._retrom_abi?.() === 1;
}
export function withBytes<T>(core: NativeCore, bytes: Uint8Array, use: (pointer: number) => T): T {
  const pointer = core._malloc(bytes.length);
  if (!pointer) {throw new Error("FANTASY_ALLOCATION_FAILED");}
  try {core.HEAPU8.set(bytes, pointer); return use(pointer);} finally {core._free(pointer);}
}
