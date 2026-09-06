// @vitest-environment jsdom
import {describe, expect, it, vi} from "vitest";
import {mountJ2me} from "./adapter.js";

const config = {sessionId: "launch", contentDigest: "a".repeat(64), jarSizeBytes: 10,
  jarUrl: "http://localhost/content/game.jar", runtimeBaseUrl: "http://localhost/runtime/"};
function fixture() {
  const target = document.createElement("div");
  let listener: (event: {type: string; code?: string}) => void = () => undefined;
  const unsubscribe = vi.fn();
  const core = {mount: vi.fn(), exit: vi.fn(), pause: vi.fn(), resume: vi.fn(), screenshot: vi.fn(),
    acknowledgeCheckpoint: vi.fn(async () => undefined),
    getCanvas: () => null, getFrameCount: () => 3, setVolume: vi.fn(),
    getCheckpointAvailability: () => ({available: true, blocker: null}),
    checkpoint: vi.fn(async () => ({format: "j2me-rms-bundle-v1", bytes: new Uint8Array([1, 2])})),
    subscribe: vi.fn((fn) => {listener = fn; return unsubscribe;})};
  const module = {runtimeAdapter: {adapterAbi: "j2me-rms", checkpointFormat: "j2me-rms-bundle-v1",
    automaticViewport: true}, createRuntime: vi.fn(() => core)};
  const onExit = vi.fn();
  const onFailure = vi.fn();
  return {target, core, module, onExit, onFailure, unsubscribe, emit: (event: {type: string; code?: string}) => listener(event),
    mount: (restore: Uint8Array | null = null) => mountJ2me(config, target, window, restore, vi.fn(), onExit,
      onFailure, undefined, async () => module)};
}

describe("J2ME Provider adapter", () => {
  it("imports opaque RMS before mounting in a host-owned fresh runtime", async () => {
    const f = fixture();
    const restore = new Uint8Array([8]);
    const adapter = await f.mount(restore);
    expect(f.module.createRuntime).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({kind: "J2ME_JAR_V1", sha256: config.contentDigest}),
      adapter: expect.objectContaining({storage: "HOST"}),
    }), expect.objectContaining({restorePayload: restore, frameWindow: window}));
    expect(f.core.mount).toHaveBeenCalledWith(f.target);
    expect(await adapter.checkpoint()).toEqual({format: "j2me-rms-bundle-v1", bytes: new Uint8Array([1, 2])});
    expect(f.core.acknowledgeCheckpoint).not.toHaveBeenCalled();
    const saved = await adapter.checkpoint();
    await adapter.acknowledgeCheckpoint?.(saved);
    expect(f.core.acknowledgeCheckpoint).toHaveBeenCalledWith(saved);
    await adapter.pause(); await adapter.resume();
    expect(f.core.pause).toHaveBeenCalledOnce(); expect(f.core.resume).toHaveBeenCalledOnce();
  });
  it("reports native exit once and closes checkpoint availability before cleanup", async () => {
    const f = fixture(); const adapter = await f.mount();
    f.emit({type: "EXIT_REQUESTED"}); f.emit({type: "EXIT_REQUESTED"});
    expect(f.onExit).toHaveBeenCalledOnce();
    expect(adapter.getCheckpointAvailability().available).toBe(false);
    await adapter.exit(); await adapter.exit();
    expect(f.core.exit).toHaveBeenCalledOnce(); expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it("reports fatal core errors and cleans failed mounts", async () => {
    const f = fixture(); const adapter = await f.mount();
    f.emit({type: "FATAL_ERROR", code: "J2ME_RUNTIME_FAILED"});
    expect(f.onFailure).toHaveBeenCalledWith(new Error("J2ME_RUNTIME_FAILED"));
    await adapter.exit();
    const failed = fixture(); failed.core.mount.mockRejectedValue(new Error("load failed"));
    await expect(failed.mount()).rejects.toThrow("load failed");
    expect(failed.core.exit).toHaveBeenCalledOnce();
  });
  it("rejects an incompatible ABI and oversized restores before creating a VM", async () => {
    const f = fixture(); f.module.runtimeAdapter.adapterAbi = "wrong";
    await expect(f.mount()).rejects.toThrow("J2ME_CORE_ABI_MISMATCH");
    await expect(f.mount(new Uint8Array(2 * 1024 * 1024 + 1))).rejects.toThrow("J2ME_RUNTIME_CONFIG_INVALID");
    expect(f.module.createRuntime).not.toHaveBeenCalled();
  });
});
