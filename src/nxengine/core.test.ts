import {afterEach, expect, it, vi} from "vitest";
import {sha256} from "@noble/hashes/sha2.js";
import {loadCore} from "./core.js";
import {mountNXEngine} from "./adapter.js";
afterEach(() => vi.unstubAllGlobals());
const bytes = Uint8Array.of(1);
const digest = Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
const config = {projectIndexUrl: "/runtime/projects/digest/index.json", contentDigest: "a".repeat(64),
  runtimeBaseUrl: "/runtime/providers/bundle/assets/nxengine/", assetIndex: Object.fromEntries(
    ["nxengine-retrom.mjs", "nxengine-retrom.wasm"].map((name) => [`assets/nxengine/${name}`, {sizeBytes: 1, sha256: digest}]))};
it("resolves host-relative asset and project URLs before loading the native module", async () => {
  const files = ["Doukutsu.exe", "data/npc.tbl", "data/Stage/Start.pxm", "data/Stage/Start.tsc"]
    .map((path) => ({path, sizeBytes: 1, url: path}));
  const fetch = vi.fn(async (url: string) => url.endsWith("index.json")
    ? Response.json({schemaVersion: 1, files}) : new Response(bytes));
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("caches", undefined);
  const loader = vi.fn(async () => {throw Error("TEST_MODULE_BOUNDARY");});
  await expect(loadCore(config, () => undefined, undefined, loader)).rejects.toThrow("TEST_MODULE_BOUNDARY");
  expect(loader).toHaveBeenCalledWith(new URL(`${config.runtimeBaseUrl}nxengine-retrom.mjs`, window.location.href).href);
  expect(fetch.mock.calls.map(([url]) => url)).toContain(new URL("/runtime/projects/digest/data/npc.tbl", window.location.href).href);
});
it("rejects corrupt restore data before allocating or fetching a core", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(mountNXEngine(config, document.createElement("div"), window, Uint8Array.of(1),
    () => undefined, () => undefined)).rejects.toThrow("NXENGINE_SAVE_INVALID");
  expect(fetch).not.toHaveBeenCalled();
});
it("does not let bundled profiles seed native progress in a fresh machine", async () => {
  const files = ["Doukutsu.exe", "data/npc.tbl", "data/Stage/Start.pxm", "data/Stage/Start.tsc", "profile.dat", "profile3.dat"]
    .map((path) => ({path, sizeBytes: 1, url: path}));
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("index.json")
    ? Response.json({schemaVersion: 1, files}) : new Response(bytes));
  vi.stubGlobal("caches", undefined);
  const core = {HEAPU8: new Uint8Array(1024), HEAP16: new Int16Array(512),
    FS: {mkdirTree: vi.fn(), writeFile: vi.fn(), readFile: () => bytes, readdir: () => [], stat: () => ({size: 0})},
    _malloc: () => 8, _free() {}, _retrom_abi: () => 1, _retrom_load: () => 1, _retrom_ready: () => 1,
    _retrom_step: () => 1, _retrom_key() {}, _retrom_pixels: () => 1, _retrom_width: () => 320,
    _retrom_height: () => 240, _retrom_fps: () => 60, _retrom_audio: () => 1, _retrom_audio_count: () => 0, _retrom_stop() {}};
  await loadCore(config, () => undefined, undefined, async () => ({default: async () => core}));
  expect(core.FS.writeFile.mock.calls.map(([path]) => path)).toEqual([
    "/game/Doukutsu.exe", "/game/data/npc.tbl", "/game/data/Stage/Start.pxm", "/game/data/Stage/Start.tsc",
  ]);
});
