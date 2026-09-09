// @vitest-environment jsdom
import {describe, expect, it, vi} from "vitest";
import {mountPlay} from "./adapter.js";

const config = {disc: {kind: "SEEKABLE_BLOB" as const, rangeRequired: true as const,
  url: "http://localhost/disc", sizeBytes: 8_000_000_000, sha256: "a".repeat(64)},
  runtimeBaseUrl: "http://localhost/core/"};

describe("Play! adapter", () => {
  it("forwards a seekable disc and restore without downloading the game", async () => {
    const target = document.createElement("div");
    const canvas = document.createElement("canvas");
    const core = {canvas, checkpoint: vi.fn(async () => new Uint8Array([1, 2])),
      frameCount: () => 10, pause: vi.fn(), resume: vi.fn(), screenshot: vi.fn(), stop: vi.fn()};
    const create = vi.fn(async (_options: unknown) => core);
    const loader = async () => ({RETROM_PLAY_ABI: "play-host-v1", RETROM_PLAY_CHECKPOINT_MAX_BYTES: 268435456, createRetromPlay: create});
    const restore = new Uint8Array([3]);
    const adapter = await mountPlay(config, target, window, restore, vi.fn(), undefined, loader);
    expect(create.mock.calls[0]?.[0]).toMatchObject({disc: config.disc, restorePayload: restore});
    await adapter.pause(); await adapter.resume();
    expect(core.pause).toHaveBeenCalledOnce(); expect(core.resume).toHaveBeenCalledOnce();
    expect(await adapter.checkpoint()).toEqual({format: "play-state-v1", bytes: new Uint8Array([1, 2])});
    await adapter.exit(); await adapter.exit();
    expect(core.stop).toHaveBeenCalledOnce();
    expect(adapter.getCheckpointAvailability().available).toBe(false);
    await expect(adapter.checkpoint()).rejects.toThrow("PLAY_RUNTIME_EXITED");
  });

  it("rejects an incompatible core before starting", async () => {
    await expect(mountPlay(config, document.createElement("div"), window, null, vi.fn(), undefined,
      async () => ({RETROM_PLAY_ABI: "unknown"}))).rejects.toThrow("PLAY_CORE_ABI_MISMATCH");
  });
});
