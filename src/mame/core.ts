import {loadCoreAsset} from "../provider/core-assets.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {profiles, type MameMachine} from "./profiles.js";
export type FileSource = {url: string; sha256: string; sizeBytes: number};
export type MameParameters = {machine: MameMachine; game: FileSource; bios: (FileSource & {logicalName: string})[]; runtimeBaseUrl: string};
export type MameCore = {
  HEAPU8: Uint8Array; HEAP16: Int16Array;
  FS: {mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array): void; chmod(path: string, mode: number): void; ignorePermissions: boolean};
  loadDynamicLibrary(url: string, flags: {global: boolean; nodelete: boolean; loadAsync: boolean}): Promise<unknown>;
  UTF8ToString(pointer: number): string;
  _malloc(size: number): number; _free(pointer: number): void;
  _retrom_mame_abi(): number; _retrom_mame_build_id(): number; _retrom_mame_attach(): number;
  _retrom_mame_start(pointer: number): number; _retrom_mame_step(): number; _retrom_mame_stop(): void;
  _retrom_mame_key(key: number, down: number): void; _retrom_mame_button(button: number, down: number): void;
  _retrom_mame_axis(axis: number, value: number): void;
  _retrom_mame_width(): number; _retrom_mame_height(): number; _retrom_mame_pixels(): number;
  _retrom_mame_audio(): number; _retrom_mame_audio_count(): number;
  _retrom_mame_fps(): number; _retrom_mame_sample_rate(): number;
  _retrom_mame_aspect_ratio(): number;
  _retrom_mame_save_size(): number; _retrom_mame_save(pointer: number, size: number): number;
  _retrom_mame_restore(pointer: number, size: number): number;
};
export type ModuleLoader = (url: string) => Promise<unknown>;
export async function loadCore(config: MameParameters, content: AdapterContentOptions,
  loader: ModuleLoader = url => import(/* webpackIgnore: true */ /* @vite-ignore */ url)) {
  const family = profiles[config.machine].family;
  const files = ["mame-build.json", "mame-common.mjs", "mame-common.wasm", `mame-${family}.wasm`];
  const base = new URL("assets/mame/", new URL(config.runtimeBaseUrl, globalThis.location?.href));
  const sizes = files.map(name => content.assetIndex[`assets/mame/${name}`]?.sizeBytes ?? 0);
  const total = sizes.reduce((a, b) => a + b, 0), ready = sizes.map(() => 0);
  const loaded = await Promise.all(files.map((name, i) => loadCoreAsset(content, new URL(name, base).href,
    `assets/mame/${name}`, name.endsWith(".wasm") ? 128 * 1024 * 1024 : 2 * 1024 * 1024, content.signal,
    progress => {ready[i] = progress.readyBytes; content.reportProgress?.({phase: "RUNTIME_ASSET", loadedBytes: ready.reduce((a, b) => a + b, 0), totalBytes: total});})));
  const build = parseBuild(loaded[0], content, files, family, config.machine);
  const moduleURL = URL.createObjectURL(new Blob([Uint8Array.from(loaded[1])], {type: "text/javascript"}));
  let core: MameCore | undefined;
  try {
    const module = await loader(moduleURL);
    if (!module || typeof module !== "object" || !("default" in module) || typeof module.default !== "function") {invalid();}
    content.signal?.throwIfAborted();
    const value: unknown = await module.default({wasmBinary: loaded[2], locateFile: (name: string) => new URL(name, base).href,
      print: () => undefined, printErr: nativeLog});
    if (!validCore(value)) {invalid();} core = value;
    if (core.UTF8ToString(core._retrom_mame_build_id()) !== build) {invalid();}
    const familyURL = URL.createObjectURL(new Blob([Uint8Array.from(loaded[3])], {type: "application/wasm"}));
    try {await core.loadDynamicLibrary(familyURL, {global: true, nodelete: true, loadAsync: true});}
    finally {URL.revokeObjectURL(familyURL);}
    content.signal?.throwIfAborted();
    if (core._retrom_mame_attach() !== 0) {invalid();}
    return {core, build};
  } catch (error) {core?._retrom_mame_stop(); throw error;}
  finally {URL.revokeObjectURL(moduleURL);}
}
function validCore(value: unknown): value is MameCore {
  if (!value || typeof value !== "object") {return false;}
  const core = value as Partial<MameCore>;
  const methods: (keyof MameCore)[] = ["_malloc", "_free", "loadDynamicLibrary", "UTF8ToString", "_retrom_mame_abi", "_retrom_mame_build_id",
    "_retrom_mame_attach", "_retrom_mame_start", "_retrom_mame_step", "_retrom_mame_stop", "_retrom_mame_key", "_retrom_mame_button", "_retrom_mame_axis",
    "_retrom_mame_width", "_retrom_mame_height", "_retrom_mame_pixels", "_retrom_mame_audio", "_retrom_mame_audio_count", "_retrom_mame_fps",
    "_retrom_mame_sample_rate", "_retrom_mame_aspect_ratio", "_retrom_mame_save_size", "_retrom_mame_save", "_retrom_mame_restore"];
  return ArrayBuffer.isView(core.HEAPU8) && ArrayBuffer.isView(core.HEAP16) && !!core.FS &&
    [core.FS.mkdirTree, core.FS.writeFile, core.FS.chmod].every(method => typeof method === "function") &&
    methods.every(key => typeof core[key] === "function") && core._retrom_mame_abi?.() === 1;
}
function parseBuild(bytes: Uint8Array, content: AdapterContentOptions, files: string[], family: string, machine: MameMachine): string {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!record(value) || value.schemaVersion !== 1 || value.adapterAbi !== "retrom-mame-dylink-v1" ||
    typeof value.buildId !== "string" || !/^[0-9a-f]{64}$/u.test(value.buildId) || !record(value.assets)) {invalid();}
  if (!record(value.families)) {invalid();}
  const selected = value.families[family];
  if (!record(selected) || selected.module !== files[3] || !Array.isArray(selected.machines) || !selected.machines.includes(machine)) {invalid();}
  for (const name of files.slice(1)) {
    const asset: unknown = Reflect.get(value.assets, name), expected = content.assetIndex[`assets/mame/${name}`];
    if (!record(asset) || !expected || asset.sha256 !== expected.sha256 || asset.sizeBytes !== expected.sizeBytes) {invalid();}
  }
  return value.buildId;
}
export function withMemory<T>(core: MameCore, size: number, use: (pointer: number) => T): T {
  const pointer = core._malloc(size);
  if (!pointer || pointer + size > core.HEAPU8.length) {throw new Error("MAME_ALLOCATION_FAILED");}
  try {return use(pointer);} finally {core._free(pointer);}
}
function invalid(): never {throw new Error("MAME_CORE_ABI_MISMATCH");}

function record(value: unknown): value is Record<string, unknown> {return !!value && typeof value === "object" && !Array.isArray(value);}

export function nativeLog(message: string) {
  // libretro sends ordinary progress and device registration to stderr too.
  // diimage.cpp tries READ|WRITE before READ for writable devices. This exact
  // denial is expected for our chmod(0444) disk; failure of READ is still fatal.
  const readOnlyRetry = /^:sl6:diskiing:0:525: error opening image file \/content\/game\.dsk with flags=00000003 \(generic:2 Permission denied\)\s*$/u.test(message);
  if (!readOnlyRetry && (/\berror\b|\bwarning\b/iu.test(message) || message.includes("NOT FOUND"))) {console.warn("MAME:", message);}
  else {console.debug("MAME:", message);}
}
