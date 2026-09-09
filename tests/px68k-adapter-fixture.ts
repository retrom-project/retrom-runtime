import {createHash} from "node:crypto";
import {vi} from "vitest";
import type {Px68kCore, Px68kParameters} from "../src/px68k/core.js";
export function px68kFixture() {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = {sha256, sizeBytes: bytes.length};
  const config: Px68kParameters = {game: {...file, url: "http://localhost/game.dim"},
    bios: ["iplrom.dat", "cgrom.dat"].map(logicalName => ({...file, logicalName, url: `http://localhost/${logicalName}`})),
    runtimeBaseUrl: "http://localhost/provider/", assetIndex: {
      "assets/px68k/px68k-retrom.mjs": file, "assets/px68k/px68k-retrom.wasm": file,
    }};
  const memory = new ArrayBuffer(16384), files = new Map<string, Uint8Array>();
  const core: Px68kCore = {HEAPU8: new Uint8Array(memory), HEAP16: new Int16Array(memory),
    FS: {mkdirTree: vi.fn(), writeFile: vi.fn((path, value) => {files.set(path, value);}), readFile: (path) => {
      const value = files.get(path); if (!value) {throw Error("missing file");} return value;
    }},
    _malloc: () => 1024, _free: vi.fn(), _retrom_abi: () => 1, _retrom_load: vi.fn(() => 1), _retrom_ready: () => 1,
    _retrom_step: vi.fn(() => 1), _retrom_key: vi.fn(), _retrom_width: () => 1, _retrom_height: () => 1,
    _retrom_pixels: () => 2048, _retrom_fps: () => 60, _retrom_audio: () => 2048, _retrom_audio_count: () => 0,
    _retrom_stop: vi.fn(), _retrom_state: () => 4096, _retrom_state_size: () => 4, _retrom_restore: vi.fn(() => 1)};
  core.HEAPU8.set([9, 8, 7, 6], 4096);
  let scheduled: FrameRequestCallback | undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {scheduled = callback; return 1;});
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {scheduled = undefined;});
  const graphics = {createImageData: (w: number, h: number) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData: vi.fn()};
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => graphics as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  vi.stubGlobal("caches", undefined);
  const target = document.createElement("div"); document.body.append(target);
  const loader = vi.fn(async () => ({default: async () => core}));
  return {core, config, target, loader, files, frame: (time: number) => {const next = scheduled; scheduled = undefined; next?.(time);}};
}
