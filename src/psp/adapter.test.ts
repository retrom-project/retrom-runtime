// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {mountPSP} from "./adapter.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {abi as contentAbi, contractSha256} from "../content-io/identity.js";
import {verifiedContentAsset} from "../content-io/bootstrap.js";
vi.mock("../content-io/bootstrap.js", () => ({verifiedContentAsset: vi.fn(async () => new Blob(["verified sync client"]))}));
const owners: ReturnType<typeof contentSessionFixture>[] = [];
const config = {assetIndex: {}, game: {kind: "SEEKABLE_BLOB" as const, rangeRequired: true as const, url: "http://localhost/game", sizeBytes: 3, sha256: "a".repeat(64)}, runtimeBaseUrl: "http://localhost/core/"};

function setup() {
  const core = {canvas: document.createElement("canvas"), checkpoint: vi.fn(async () => new Uint8Array([1, 2])),
    frameCount: () => 10, pause: vi.fn(), resume: vi.fn(), screenshot: vi.fn(), stop: vi.fn(), setVolume: vi.fn()};
  const create = vi.fn(async (_options: unknown) => core);
  const loader = async () => ({abi: "ppsspp-host-v3", contentAbi, contractSha256, createPPSSPPHost: create});
  const owner = contentSessionFixture(location.origin, [location.origin, "http://localhost"]); owners.push(owner);
  const content = {contentSession: {...owner.session, createSyncChannel: vi.fn(async (fileId: string) => ({
    fileId, objectKey: "a".repeat(64), sizeBytes: config.game.sizeBytes, port: {postMessage() {}, close() {}} as unknown as MessagePort,
    buffer: new SharedArrayBuffer(262208), sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1 as const, l1BudgetBytes: 2097152,
  }))}, runtimeBaseURL: "http://localhost/"};
  Object.assign(URL, {createObjectURL: vi.fn(() => "blob:http://localhost/verified-client"), revokeObjectURL: vi.fn()});
  return {core, create, loader, content, owner};
}
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.unstubAllGlobals();});
describe("independent PSP adapter", () => {
  it("registers relative sources on management and hands only metadata to the worker", async () => {
    const {create, loader, content} = setup();
    const adapter = await mountPSP({...config, game: {...config.game, url: "/game"}}, document.createElement("div"), window,
      null, vi.fn(), vi.fn(), undefined, {loader}, content);
    expect(create.mock.calls[0]?.[0]).toMatchObject({source: {sha256: config.game.sha256, sizeBytes: 3}});
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("source.url");
    expect(content.contentSession.createSyncChannel).toHaveBeenCalledOnce();
    expect(verifiedContentAsset).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/verified-client");
    await adapter.exit();
  });
  it("passes a seekable source without downloading the whole game", async () => {
    const {create, loader, content} = setup(), download = vi.fn(), progress = vi.fn();
    vi.stubGlobal("fetch", download);
    const adapter = await mountPSP(config, document.createElement("div"), window, null, progress, vi.fn(), undefined,
      {loader}, content);
    expect(download).not.toHaveBeenCalled();
    expect(create.mock.calls[0]?.[0]).toMatchObject({source: {sha256: config.game.sha256, sizeBytes: config.game.sizeBytes}});
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("file");
    expect(progress).not.toHaveBeenCalled();
    await adapter.exit();
  });
  it("[BR-07] UNIT/ppsspp-lifecycle restores into a new core, propagates controls and owns cleanup", async () => {
    const {core, create, loader, content} = setup(), target = document.createElement("div"), restore = new Uint8Array([3]);
    const adapter = await mountPSP(config, target, window, restore, vi.fn(), vi.fn(), undefined, {loader}, content);
    expect(create.mock.calls[0]?.[0]).toMatchObject({restore, target, source: {sha256: config.game.sha256, sizeBytes: config.game.sizeBytes}});
    await adapter.pause(); await adapter.resume(); adapter.setVolume?.(0.4);
    expect(core.pause).toHaveBeenCalledOnce(); expect(core.resume).toHaveBeenCalledOnce();
    expect(core.setVolume).toHaveBeenCalledWith(0.4);
    expect(await adapter.checkpoint()).toEqual({format: "ppsspp-state-v1", bytes: new Uint8Array([1, 2])});
    await adapter.exit(); await adapter.exit(); expect(core.stop).toHaveBeenCalledOnce();
    expect(adapter.getCheckpointAvailability().available).toBe(false);
    await expect(adapter.checkpoint()).rejects.toThrow("PPSSPP_RUNTIME_EXITED");
  });
  it("[BR-12] UNIT/ppsspp-abi rejects an incompatible ABI and empty checkpoints", async () => {
    const args = [config, document.createElement("div"), window, null, vi.fn(), vi.fn(), undefined] as const;
    await expect(mountPSP(...args, {loader: async () => ({abi: "old"})})).rejects.toThrow("PPSSPP_CORE_ABI_MISMATCH");
    const {core, loader, content} = setup(); core.checkpoint.mockResolvedValue(new Uint8Array());
    const adapter = await mountPSP(...args, {loader}, content);
    await expect(adapter.checkpoint()).rejects.toThrow("PPSSPP_CHECKPOINT_INVALID");
    await adapter.exit();
  });
});
