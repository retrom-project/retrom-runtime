import {afterEach, expect, it, vi} from "vitest";
import {sha256} from "@noble/hashes/sha2.js";
import {mountGBE} from "./adapter.js";
import type {GBECore} from "./core.js";
import {encodeState} from "./state.js";
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
function fixture() {
  const game = new Uint8Array(0x2200), bios = new Uint8Array(4096);
  const hash = (bytes: Uint8Array) => Array.from(sha256(bytes), v => v.toString(16).padStart(2, "0")).join("");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("bios") ? bios : game)));
  const config = {game: {url: "https://retrom.test/game", sizeBytes: game.length, sha256: hash(game)},
    bios: [{url: "https://retrom.test/bios", logicalName: "bios.min", sizeBytes: bios.length, sha256: hash(bios)}],
    runtimeBaseUrl: "https://retrom.test/runtime/", assetIndex: {}};
  const files = new Map<string, Uint8Array>();
  const core: GBECore = {FS: {writeFile: (p, bytes) => {files.set(p, bytes.slice());},
    readFile: p => files.get(p)?.slice() ?? new Uint8Array(), unlink: p => {files.delete(p);}},
  _retrom_init: vi.fn(() => 0), _retrom_is_ready: () => 1, _retrom_frame_count: () => 21,
  _retrom_pause: vi.fn(), _retrom_key: vi.fn(), _retrom_stop: vi.fn(), _retrom_volume: vi.fn(),
  _retrom_save: vi.fn(() => {files.set("/game.min.ss", new Uint8Array([8, 9, 10])); return 0;}),
  _retrom_restore: vi.fn(() => 0)};
  return {config, core, files, loader: async () => core};
}
it("restores a full execution snapshot before resuming a different core and cleans up", async () => {
  const first = fixture();
  const adapter = await mountGBE(first.config, document.body, window, null, vi.fn(), undefined, first.loader);
  const checkpoint = await adapter.checkpoint();
  expect(checkpoint.format).toBe("gbe-pokemini-state-v1");
  expect(first.core._retrom_pause).toHaveBeenLastCalledWith(0);
  await adapter.exit(); await adapter.exit(); expect(first.core._retrom_stop).toHaveBeenCalledOnce();
  const second = fixture();
  second.core._retrom_restore = vi.fn(() => {
    expect(second.files.get("/game.min.ss")).toEqual(new Uint8Array([8, 9, 10]));
    expect(second.core._retrom_pause).not.toHaveBeenCalledWith(0); return 0;
  });
  const restored = await mountGBE(second.config, document.body, window, checkpoint.bytes, vi.fn(), undefined, second.loader);
  expect(second.core._retrom_restore).toHaveBeenCalledOnce();
  await restored.pause(); expect(second.core._retrom_pause).toHaveBeenLastCalledWith(1);
  await restored.checkpoint(); expect(second.core._retrom_pause).toHaveBeenLastCalledWith(1);
  await restored.resume(); expect(second.core._retrom_pause).toHaveBeenLastCalledWith(0);
  await restored.exit(); expect(document.querySelector("canvas")).toBeNull();
  await expect(restored.checkpoint()).rejects.toThrow("GBE_RUNTIME_EXITED");
});
it("fails closed and releases the core on native restore failure", async () => {
  const f = fixture(); f.core._retrom_restore = () => -1;
  await expect(mountGBE(f.config, document.body, window, encodeState(f.config.game.sha256, new Uint8Array([1])),
    vi.fn(), undefined, f.loader)).rejects.toThrow("GBE_RESTORE_FAILED");
  expect(f.core._retrom_stop).toHaveBeenCalledOnce(); expect(document.querySelector("canvas")).toBeNull();
});
it("requires BIOS and aborts without starting a core", async () => {
  const f = fixture();
  await expect(mountGBE({...f.config, bios: []}, document.body, window, null, vi.fn(), undefined, f.loader)).rejects.toThrow("GBE_BIOS_MISSING");
  const abort = new AbortController(); abort.abort();
  await expect(mountGBE(f.config, document.body, window, null, vi.fn(), abort.signal, f.loader)).rejects.toThrow();
  expect(f.core._retrom_init).not.toHaveBeenCalled();
});
