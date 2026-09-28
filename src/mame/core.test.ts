import {loadCoreAsset} from "../provider/core-assets.js";
import {afterEach, beforeEach, expect, test, vi} from "vitest";
import {loadCore, type MameCore} from "./core.js";
import {eagerPolicy} from "../provider/content-policies.js";
const state = vi.hoisted(() => ({build: "a".repeat(64), assetHash: "b".repeat(64), atomMachine: "atom"}));
vi.mock("../provider/core-assets.js", () => ({loadCoreAsset: vi.fn(async (_options, _url, path: string) => {
  if (!path.endsWith(".json")) {return new Uint8Array(8);}
  const assets = Object.fromEntries(["mame-common.mjs", "mame-common.wasm", "mame-apple.wasm", "mame-acorn.wasm", "mame-vintage.wasm"].map(name =>
    [name, {sha256: state.assetHash, sizeBytes: 8}]));
  return new TextEncoder().encode(JSON.stringify({schemaVersion: 1, adapterAbi: "retrom-mame-dylink-v1", buildId: state.build, assets, families: {apple: {module: "mame-apple.wasm", machines: ["apple2p"]}, acorn: {module: "mame-acorn.wasm", machines: [state.atomMachine]}, vintage: {module: "mame-vintage.wasm", machines: ["pv1000"]}}}));
})}));
const config = {machine: "apple2p" as const, runtimeBaseUrl: "https://example.test/runtime/", game: {url: "/game", sha256: "a".repeat(64), sizeBytes: 143360}, bios: []};
const content = {assetIndex: Object.fromEntries(["mame-build.json", "mame-common.mjs", "mame-common.wasm", "mame-apple.wasm", "mame-acorn.wasm", "mame-vintage.wasm"].map(name =>
  [`assets/mame/${name}`, {sha256: "b".repeat(64), sizeBytes: 8}])),
contentSession: {inputPolicy: () => eagerPolicy(143360), open: async () => {throw Error("unused");},
  materialize: async () => {throw Error("unused");}, closeFile: async () => {}}};
function fixture(): MameCore {
  return {HEAPU8: new Uint8Array(1024), HEAP16: new Int16Array(512),
    FS: {mkdirTree: vi.fn(), writeFile: vi.fn(), chmod: vi.fn(), ignorePermissions: true},
    loadDynamicLibrary: vi.fn(async () => undefined), UTF8ToString: () => "a".repeat(64),
    _malloc: () => 32, _free: vi.fn(), _retrom_mame_abi: () => 1, _retrom_mame_build_id: () => 1,
    _retrom_mame_attach: vi.fn(() => 0), _retrom_mame_start: () => 1, _retrom_mame_step: () => 1,
    _retrom_mame_stop: vi.fn(), _retrom_mame_key: vi.fn(), _retrom_mame_button: vi.fn(), _retrom_mame_axis: vi.fn(),
    _retrom_mame_width: () => 560, _retrom_mame_height: () => 192, _retrom_mame_pixels: () => 32,
    _retrom_mame_audio: () => 32, _retrom_mame_audio_count: () => 0, _retrom_mame_fps: () => 60,
    _retrom_mame_sample_rate: () => 48000, _retrom_mame_aspect_ratio: () => 4 / 3,
    _retrom_mame_save_size: () => 8, _retrom_mame_save: () => 1, _retrom_mame_restore: () => 1};
}
beforeEach(() => {
  state.build = "a".repeat(64); state.assetHash = "b".repeat(64); state.atomMachine = "atom";
  vi.stubGlobal("URL", class extends URL {static createObjectURL = vi.fn(() => "blob:verified"); static revokeObjectURL = vi.fn();});
});
afterEach(() => vi.unstubAllGlobals());
test("registers the verified family after matching the native build and releases temporary URLs", async () => {
  const core = fixture(); const loader = vi.fn(async () => ({default: async () => core}));
  expect((await loadCore(config, content, loader)).core).toBe(core);
  expect(core.loadDynamicLibrary).toHaveBeenCalledWith("blob:verified", {global: true, nodelete: true, loadAsync: true});
  expect(core._retrom_mame_attach).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
test("rejects metadata outside the verified asset index before executing any JS", async () => {
  state.assetHash = "c".repeat(64); const loader = vi.fn();
  await expect(loadCore(config, content, loader)).rejects.toThrow("MAME_CORE_ABI_MISMATCH");
  expect(loader).not.toHaveBeenCalled();
});
test("stops a mismatched native build before loading its family", async () => {
  state.build = "c".repeat(64); const core = fixture();
  await expect(loadCore(config, content, async () => ({default: async () => core}))).rejects.toThrow("MAME_CORE_ABI_MISMATCH");
  expect(core._retrom_mame_stop).toHaveBeenCalledOnce(); expect(core.loadDynamicLibrary).not.toHaveBeenCalled();
});
test("stops and revokes URLs when dynamic relocation fails", async () => {
  const core = fixture(); core.loadDynamicLibrary = vi.fn(async () => {throw Error("relocation");});
  await expect(loadCore(config, content, async () => ({default: async () => core}))).rejects.toThrow("relocation");
  expect(core._retrom_mame_stop).toHaveBeenCalledOnce(); expect(core._retrom_mame_attach).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
test("cancellation during module initialization prevents registration and cleans up", async () => {
  const core = fixture(), controller = new AbortController();
  const loader = async () => ({default: async () => {controller.abort(); return core;}});
  await expect(loadCore(config, {...content, signal: controller.signal}, loader)).rejects.toThrow();
  expect(core._retrom_mame_stop).toHaveBeenCalledOnce(); expect(core._retrom_mame_attach).not.toHaveBeenCalled();
});

test.each([['atom', 'acorn'], ['pv1000', 'vintage']] as const)("loads only the selected %s family alongside the common runtime", async (machine, family) => {
  vi.mocked(loadCoreAsset).mockClear();
  const core = fixture();
  await loadCore({...config, machine}, content, async () => ({default: async () => core}));
  expect(vi.mocked(loadCoreAsset).mock.calls.map(call => call[2])).toEqual([
    "assets/mame/mame-build.json", "assets/mame/mame-common.mjs", "assets/mame/mame-common.wasm", `assets/mame/mame-${family}.wasm`,
  ]);
});

test("rejects a selected machine missing from family metadata before executing JS", async () => {
  state.atomMachine = "apple2p";
  const loader = vi.fn();
  await expect(loadCore({...config, machine: "atom"}, content, loader)).rejects.toThrow("MAME_CORE_ABI_MISMATCH");
  expect(loader).not.toHaveBeenCalled();
});
