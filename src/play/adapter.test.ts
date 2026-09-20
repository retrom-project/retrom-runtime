import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {abi as contentAbi, contractSha256} from "../content-io/identity.js";
// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {mountPlay} from "./adapter.js";

const config = {disc: {kind: "SEEKABLE_BLOB" as const, rangeRequired: true as const,
  url: "http://localhost/disc", sizeBytes: 8_000_000_000, sha256: "a".repeat(64)},
  runtimeBaseUrl: "http://localhost/core/"};

const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close()));});
describe("Play! adapter", () => {
  it("[BR-07] UNIT/play-lifecycle forwards a seekable disc and restore without downloading the game", async () => {
    const target = document.createElement("div");
    const canvas = document.createElement("canvas");
    const core = {canvas, checkpoint: vi.fn(async () => new Uint8Array([1, 2])),
      frameCount: () => 10, pause: vi.fn(), resume: vi.fn(), screenshot: vi.fn(), stop: vi.fn()};
    const create = vi.fn(async (_options: unknown) => core);
    const loader = async () => ({RETROM_PLAY_ABI: "play-host-v2", contentAbi, contractSha256, RETROM_PLAY_CHECKPOINT_MAX_BYTES: 268435456, createRetromPlay: create});
    const restore = new Uint8Array([3]);
    const owner = contentSessionFixture(location.origin, [location.origin, "http://localhost"]); owners.push(owner);
    const adapter = await mountPlay(config, target, window, restore, vi.fn(), undefined, loader, {contentSession: owner.session, assetIndex: {}});
    expect(create.mock.calls[0]?.[0]).toMatchObject({disc: {sha256: config.disc.sha256, sizeBytes: config.disc.sizeBytes}, content: {abi: contentAbi, contractSha256}, restorePayload: restore});
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("disc.url");
    await adapter.pause(); await adapter.resume();
    expect(core.pause).toHaveBeenCalledOnce(); expect(core.resume).toHaveBeenCalledOnce();
    expect(await adapter.checkpoint()).toEqual({format: "play-state-v1", bytes: new Uint8Array([1, 2])});
    await adapter.exit(); await adapter.exit();
    expect(core.stop).toHaveBeenCalledOnce(); expect(owner.files.size).toBe(0);
    expect(adapter.getCheckpointAvailability().available).toBe(false);
    await expect(adapter.checkpoint()).rejects.toThrow("PLAY_RUNTIME_EXITED");
  });

  it("[BR-12] UNIT/play-abi rejects an incompatible core before starting", async () => {
    await expect(mountPlay(config, document.createElement("div"), window, null, vi.fn(), undefined,
      async () => ({RETROM_PLAY_ABI: "unknown"}))).rejects.toThrow("PLAY_CORE_ABI_MISMATCH");
  });
});
