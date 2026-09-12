// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {mountPSP} from "./adapter.js";
const config = {game: {kind: "SEEKABLE_BLOB" as const, rangeRequired: true as const, url: "http://localhost/game", sizeBytes: 3, sha256: "a".repeat(64)}, runtimeBaseUrl: "http://localhost/core/"};

function setup() {
  const core = {canvas: document.createElement("canvas"), checkpoint: vi.fn(async () => new Uint8Array([1, 2])),
    frameCount: () => 10, pause: vi.fn(), resume: vi.fn(), screenshot: vi.fn(), stop: vi.fn(), setVolume: vi.fn()};
  const create = vi.fn(async (_options: unknown) => core);
  const loader = async () => ({abi: "ppsspp-host-v2", createPPSSPPHost: create});
  return {core, create, loader};
}
afterEach(() => vi.unstubAllGlobals());
describe("independent PSP adapter", () => {
  it("resolves host-relative game URLs before handing them to a worker", async () => {
    const {create, loader} = setup();
    const adapter = await mountPSP({...config, game: {...config.game, url: "/game"}}, document.createElement("div"), window,
      null, vi.fn(), vi.fn(), undefined, {loader});
    expect(create.mock.calls[0]?.[0]).toMatchObject({source: {url: new URL("/game", window.location.href).href}});
    await adapter.exit();
  });
  it("passes a seekable source without downloading the whole game", async () => {
    const {create, loader} = setup(), download = vi.fn(), progress = vi.fn();
    vi.stubGlobal("fetch", download);
    const adapter = await mountPSP(config, document.createElement("div"), window, null, progress, vi.fn(), undefined,
      {loader});
    expect(download).not.toHaveBeenCalled();
    expect(create.mock.calls[0]?.[0]).toMatchObject({source: config.game});
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("file");
    expect(progress).not.toHaveBeenCalled();
    await adapter.exit();
  });
  it("restores into a new core, propagates controls and owns cleanup", async () => {
    const {core, create, loader} = setup(), target = document.createElement("div"), restore = new Uint8Array([3]);
    const adapter = await mountPSP(config, target, window, restore, vi.fn(), vi.fn(), undefined, {loader});
    expect(create.mock.calls[0]?.[0]).toMatchObject({restore, target, source: config.game});
    await adapter.pause(); await adapter.resume(); adapter.setVolume?.(0.4);
    expect(core.pause).toHaveBeenCalledOnce(); expect(core.resume).toHaveBeenCalledOnce();
    expect(core.setVolume).toHaveBeenCalledWith(0.4);
    expect(await adapter.checkpoint()).toEqual({format: "ppsspp-state-v1", bytes: new Uint8Array([1, 2])});
    await adapter.exit(); await adapter.exit(); expect(core.stop).toHaveBeenCalledOnce();
    expect(adapter.getCheckpointAvailability().available).toBe(false);
    await expect(adapter.checkpoint()).rejects.toThrow("PPSSPP_RUNTIME_EXITED");
  });
  it("rejects an incompatible ABI and empty checkpoints", async () => {
    const args = [config, document.createElement("div"), window, null, vi.fn(), vi.fn(), undefined] as const;
    await expect(mountPSP(...args, {loader: async () => ({abi: "old"})})).rejects.toThrow("PPSSPP_CORE_ABI_MISMATCH");
    const {core, loader} = setup(); core.checkpoint.mockResolvedValue(new Uint8Array());
    const adapter = await mountPSP(...args, {loader});
    await expect(adapter.checkpoint()).rejects.toThrow("PPSSPP_CHECKPOINT_INVALID");
    await adapter.exit();
  });
});
