import {afterEach, expect, it, vi} from "vitest";
import {mountNP2} from "./adapter.js";
import type {NP2Core} from "./core.js";
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
it("transfers execution state and disk writes into a different runtime instance and cleans up", async () => {
  const disk = new Uint8Array(544), header = new DataView(disk.buffer);
  [32, 512, 256, 2, 1, 1].forEach((value, index) => header.setUint32(8 + index * 4, value, true));
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", disk)), v => v.toString(16).padStart(2, "0")).join("");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(disk)));
  const config = {disk: {url: "https://retrom.test/disk", sizeBytes: disk.length, sha256}, runtimeBaseUrl: "https://retrom.test/assets/", assetIndex: {}};
  const cores: NP2Core[] = [], stores: Map<string, Uint8Array>[] = [];
  const loader = async () => {
    const files = new Map<string, Uint8Array>(); stores.push(files);
    const core: NP2Core = {FS: {mkdirTree: vi.fn(), writeFile: (path, bytes) => {files.set(path, bytes.slice());},
      readFile: path => files.get(path)?.slice() ?? new Uint8Array(), unlink: path => {files.delete(path);}},
    callMain: vi.fn(), _retrom_is_ready: () => 1, _retrom_frame_count: () => 23, _retrom_pause: vi.fn(),
    _retrom_key: vi.fn(), _retrom_save: () => {files.set("/emulator/np2kai/state.bin", new Uint8Array([5, 6])); return 0;},
    _retrom_restore: vi.fn(() => 0), _retrom_stop: vi.fn()};
    cores.push(core); return core;
  };
  const first = await mountNP2(config, document.body, window, null, vi.fn(), vi.fn(), undefined, loader);
  vi.spyOn(first.getCanvas()!, "toBlob").mockImplementation(callback => callback({
    size: 1, type: "image/png", arrayBuffer: async () => new Uint8Array([1]).buffer,
  } as Blob));
  expect(await first.screenshot()).toBeInstanceOf(Blob);
  stores[0].get("/emulator/np2kai/game.hdi")![500] = 42;
  const saved = await first.checkpoint(); expect(saved.format).toBe("np2kai-state-v1");
  await first.exit(); await first.exit(); expect(cores[0]._retrom_stop).toHaveBeenCalledTimes(1);
  const next = await mountNP2(config, document.body, window, saved.bytes, vi.fn(), vi.fn(), undefined, loader);
  expect(stores[1].get("/emulator/np2kai/game.hdi")![500]).toBe(42);
  expect(cores[1]._retrom_restore).toHaveBeenCalledOnce();
  await next.pause(); expect(cores[1]._retrom_pause).toHaveBeenLastCalledWith(1);
  await next.resume(); expect(cores[1]._retrom_pause).toHaveBeenLastCalledWith(0);
  await next.exit(); expect(document.querySelector("canvas")).toBeNull();
  await expect(next.checkpoint()).rejects.toThrow("NP2KAI_RUNTIME_EXITED");
});
