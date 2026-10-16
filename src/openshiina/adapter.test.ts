import {afterEach, describe, expect, it, vi} from "vitest";
import {mountShiina} from "./adapter.js";
import {decodeSave, encodeSave} from "./checkpoint.js";
import {rangePolicy} from "../provider/content-policies.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {CorePlayerOptions} from "./core.js";
const digest = "a".repeat(64);
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
describe("Shiina adapter lifecycle", () => {
  it("imports native saves before boot, tracks only progress, releases inputs and tears down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files: [
      {path: "RIO.INI", sizeBytes: 17, url: "/game/ini", sha256: digest, mediaType: "application/octet-stream"},
      {path: "SJS.exe", sizeBytes: 30, url: "/game/exe", sha256: digest, mediaType: "application/octet-stream"},
      {path: "SJS_S.WAR", sizeBytes: 40, url: "/game/war", sha256: digest, mediaType: "application/octet-stream"},
    ]}))));
    const files = {"sjs_save_000.bin": new Uint8Array([1, 2, 3])};
    const restore = encodeSave(digest, files), input = vi.fn(), stop = vi.fn();
    const pause = vi.fn(), player = {info: {width: 1920, height: 1080}, input, stop, pause,
      exportSaves: vi.fn(async () => ({"sjs_save_000.bin": "BAUG"}))};
    let options!: CorePlayerOptions;
    const loader = vi.fn(async () => ({createPlayer: vi.fn(async (value: CorePlayerOptions) => {options = value; return player;})}));
    const audio = {state: "running", close: vi.fn(async () => {}), suspend: vi.fn(async () => {}), resume: vi.fn(async () => {}),
      destination: {}, createGain: () => ({gain: {value: 1}, connect() {}, disconnect() {}})};
    vi.stubGlobal("AudioContext", vi.fn(function() {return audio;}));
    const frame = document.createElement("iframe"); document.body.append(frame);
    const frameWindow = frame.contentWindow!;
    Object.defineProperty(frameWindow.document, "baseURI", {value: "about:blank"});
    Object.defineProperty(frameWindow, "AudioContext", {value: vi.fn(function() {return audio;})});
    const target = frameWindow.document.createElement("div"); frameWindow.document.body.append(target);
    const open = vi.fn(async () => ({readInto: async (_offset: number, bytes: Uint8Array) => {bytes.fill(7); return bytes.length;}, close: async () => {}}));
    const content = {contentSession: {open, inputPolicy: () => rangePolicy("ASYNC", 8 * 1024 ** 3)}} as unknown as AdapterContentOptions;
    const adapter = await mountShiina({runtimeBaseUrl: "/core/", projectIndexUrl: "/game/index", contentDigest: digest},
      target, frameWindow, restore, () => {}, vi.fn(), vi.fn(), content, loader);
    expect(loader).toHaveBeenCalledWith(new URL("/core/player.mjs", document.baseURI).href);
    expect(await options.read("SJS_S.WAR", 0, 2)).toEqual(new Uint8Array([7, 7]));
    expect(open.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({url: new URL("/game/war", document.baseURI).href})]));
    expect(options.saves).toEqual({"sjs_save_000.bin": "AQID"});
    expect(adapter.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
    options.onSaveFile("sjs_save_000.bin", new Uint8Array([4, 5, 6]), false);
    expect(adapter.getCheckpointAvailability()).toMatchObject({available: true, save: {capture: "IN_GAME", restore: "IN_GAME"}});
    const checkpoint = await adapter.checkpoint(); expect(decodeSave(checkpoint.bytes, digest)["sjs_save_000.bin"]).toEqual(new Uint8Array([4, 5, 6]));
    await adapter.acknowledgeCheckpoint!(checkpoint);
    expect(adapter.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
    frameWindow.dispatchEvent(new KeyboardEvent("keydown", {code: "Enter", keyCode: 13}));
    expect(input).toHaveBeenCalledWith(0, 13, 1, 0);
    await adapter.pause(); expect(input).toHaveBeenCalledWith(0, 13, 0, 0);
    await adapter.exit(); expect(stop).toHaveBeenCalledTimes(1); expect(target.childElementCount).toBe(0);
    input.mockClear(); frameWindow.dispatchEvent(new KeyboardEvent("keydown", {code: "Enter", keyCode: 13})); expect(input).not.toHaveBeenCalled();
  });
});
