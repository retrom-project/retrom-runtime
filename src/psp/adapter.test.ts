// @vitest-environment jsdom
import {describe, expect, it, vi} from "vitest";
import {mountPSP} from "./adapter.js";
const config = {game: {url: "http://localhost/game", sizeBytes: 3, sha256: "a".repeat(64)}, runtimeBaseUrl: "http://localhost/core/"};
const content = async () => new Blob([new Uint8Array([1, 2, 3])]);
function setup() {
  const core = {canvas: document.createElement("canvas"), checkpoint: vi.fn(async () => new Uint8Array([1, 2])),
    frameCount: () => 10, pause: vi.fn(), resume: vi.fn(), screenshot: vi.fn(), stop: vi.fn(), setVolume: vi.fn()};
  const create = vi.fn(async (_options: unknown) => core);
  const loader = async () => ({abi: "ppsspp-host-v1", createPPSSPPHost: create});
  return {core, create, loader};
}
describe("independent PSP adapter", () => {
  it("restores into a new core, propagates controls and owns cleanup", async () => {
    const {core, create, loader} = setup(), target = document.createElement("div"), restore = new Uint8Array([3]);
    const adapter = await mountPSP(config, target, window, restore, vi.fn(), vi.fn(), undefined, {loader, content});
    expect(create.mock.calls[0]?.[0]).toMatchObject({restore, target, file: expect.any(Blob)});
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
    await expect(mountPSP(...args, {loader: async () => ({abi: "old"}), content})).rejects.toThrow("PPSSPP_CORE_ABI_MISMATCH");
    const {core, loader} = setup(); core.checkpoint.mockResolvedValue(new Uint8Array());
    const adapter = await mountPSP(...args, {loader, content});
    await expect(adapter.checkpoint()).rejects.toThrow("PPSSPP_CHECKPOINT_INVALID");
    await adapter.exit();
  });
});
