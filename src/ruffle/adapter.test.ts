import {createHash, webcrypto} from "node:crypto";
import {Blob as ForeignBlob} from "node:buffer";
import {afterEach, describe, expect, it, vi} from "vitest";
import {mountRuffle} from "./adapter.js";
import type {RufflePlayer, RuffleAPI} from "./player.js";

const swf = new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0]);
const config = {swfUrl: "https://content.test/game.swf", swfSizeBytes: swf.length,
  contentDigest: createHash("sha256").update(swf).digest("hex"), runtimeBaseUrl: "https://content.test/ruffle/"};
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
function fixture() {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", async () => new Response(swf));
  const target = document.createElement("div"); document.body.append(target);
  const element = document.createElement("div") as unknown as RufflePlayer;
  const canvas = document.createElement("canvas"); element.append(canvas);
  const api = {hostAbi: "ruffle-host-v1", readyState: 2, load: vi.fn(async (): Promise<void> => undefined),
    suspend: vi.fn(), resume: vi.fn(), destroy: vi.fn(), captureFrame: vi.fn(async () => new Blob([new Uint8Array([1])], {type: "image/png"})),
    getCanvas: () => canvas, volume: 1} satisfies RuffleAPI;
  element.ruffle = () => api;
  return {target, element, api, loader: vi.fn(async () => element)};
}
describe("Ruffle adapter", () => {
  it("normalizes a core-realm screenshot to the Host Blob contract", async () => {
    const f = fixture();
    const image = new ForeignBlob([new Uint8Array([1, 2, 3])], {type: "image/png"});
    expect(image).not.toBeInstanceOf(Blob);
    f.api.captureFrame.mockResolvedValue(image as unknown as Blob);
    const runtime = await mountRuffle(config, f.target, window, null, () => undefined, undefined, f.loader);
    const screenshot = await runtime.screenshot();
    expect(screenshot).toBeInstanceOf(Blob);
    expect(screenshot.type).toBe("image/png");
    expect(new Uint8Array(await screenshot.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    await runtime.exit();
  });
  it("installs private storage before load and uses restricted, stable movie configuration", async () => {
    const f = fixture();
    const runtime = await mountRuffle(config, f.target, window, null, () => undefined, undefined, f.loader);
    const options = f.api.load.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(options[0]).toMatchObject({allowScriptAccess: false, allowNetworking: "none", openUrlMode: "deny"});
    expect(options[0]).toMatchObject({scale: "showAll", forceScale: true, salign: "", forceAlign: true});
    expect(runtime).toMatchObject({canvasLayout: "CORE"});
    expect(options[0].hostMovieUrl).toContain(config.contentDigest);
    expect(options[0].hostStorage).toBeDefined();
    await runtime.pause(); expect(f.api.suspend).toHaveBeenCalled();
    await runtime.resume(); expect(f.api.resume).toHaveBeenCalled();
    expect((await runtime.screenshot()).size).toBeGreaterThan(0);
    expect(f.api.captureFrame).toHaveBeenCalledTimes(1);
    await runtime.exit(); await runtime.exit();
    expect(f.target.children).toHaveLength(0);
    expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, blocker: "NOT_READY"});
  });
  it("cleans a late load after cancellation", async () => {
    const f = fixture(); const abort = new AbortController();
    f.api.load.mockImplementation(async () => {abort.abort();});
    await expect(mountRuffle(config, f.target, window, null, () => undefined, abort.signal, f.loader)).rejects.toThrow();
    expect(f.target.children).toHaveLength(0);
  });
  it("cancels while a core load is pending and destroys the late result", async () => {
    const f = fixture(); const abort = new AbortController();
    let complete!: () => void;
    f.api.load.mockImplementation(() => new Promise<void>((resolve) => {complete = resolve; abort.abort();}));
    await expect(mountRuffle(config, f.target, window, null, () => undefined, abort.signal, f.loader)).rejects.toThrow();
    expect(f.target.children).toHaveLength(0);
    complete(); await Promise.resolve(); await Promise.resolve();
    expect(f.api.destroy).toHaveBeenCalled();
  });
});
