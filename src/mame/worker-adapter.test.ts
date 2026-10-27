import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {mountMameWorker} from "./worker-adapter.js";
import type {MameWorkerBoot} from "./worker.js";
import {rangePolicy} from "../provider/content-policies.js";
import {decodeWorkerState} from "./worker-state.js";
import {decodeState} from "./state.js";
const fake = vi.hoisted(() => ({requests: [] as {command: string; payload: unknown}[], created: vi.fn(), close: vi.fn(), asset: vi.fn(),
  boot: null as MameWorkerBoot | null}));
vi.mock("./worker-client.js", () => ({MameWorkerClient: class {
  constructor() {fake.created();}
  close = fake.close;
  async request(command: string, payload: unknown) {
    fake.requests.push({command, payload});
    if (command === "BOOT") {fake.boot = payload as MameWorkerBoot;}
    if (command === "SAVE") {return {native: Uint8Array.of(1, 2, 3), files: [{path: "diff/disk.dif", bytes: Uint8Array.of(9)}]};}
    return {audio: [], fps: 60, rate: 48000, aspect: 3 / 4, checkpointSize: 3};
  }
}}));
vi.mock("./core.js", () => ({prepareMameCore: async () => ({manifest: {build: "b".repeat(64)}, base: new URL("https://provider.test/assets/mame/"),
  loaded: [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)]})}));
vi.mock("./files.js", () => ({prepareArcadeFiles: async () => ({identity: "a".repeat(64), files: []})}));
vi.mock("../content-io/bootstrap.js", () => ({verifiedContentAsset: fake.asset}));
vi.mock("./audio.js", () => ({MameAudio: class {resume = async () => {}; pause = async () => {}; stop = async () => {}; pushSamples = () => {};}}));
const config = {arcade: true as const, machine: "sample", game: {url: "/game", sizeBytes: 22, sha256: "a".repeat(64)},
  parents: [], deviceBios: [], media: [{url: "/disk", sizeBytes: 4 * 1024 ** 3, sha256: "b".repeat(64),
    logicalName: "renamed.chd", virtualPath: "sample/disk.chd"}], runtimeBaseUrl: "/provider/"};
let frame: HTMLIFrameElement;
let tick: FrameRequestCallback;
beforeEach(() => {
  fake.requests = []; fake.boot = null; fake.created.mockClear(); fake.close.mockClear(); fake.asset.mockResolvedValue(new Blob());
  vi.stubGlobal("URL", Object.assign(URL, {createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn()}));
  frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow!;
  Object.defineProperty(win.document.createElement("canvas").constructor.prototype, "transferControlToOffscreen", {
    configurable: true, value: () => ({}),
  });
  vi.spyOn(win, "requestAnimationFrame").mockImplementation(callback => {tick = callback; return 1;});
  vi.spyOn(win, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => {frame.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
function content(signal?: AbortSignal) {
  const close = vi.fn(async () => {});
  return {assetIndex: {}, signal, contentSession: {inputPolicy: () => rangePolicy("SYNC_WORKER", Number.MAX_SAFE_INTEGER),
    open: vi.fn(async () => ({id: "disk", close, abi: "content-io-v1" as const, sizeBytes: 4 * 1024 ** 3,
      readInto: vi.fn(async () => 0), tryReadInto: vi.fn(() => 0), stream: vi.fn(async function* () {yield new Uint8Array();})})), materialize: vi.fn(), closeFile: vi.fn(),
    createSyncChannel: vi.fn(async () => ({port: {}}))}, close};
}
it("resolves assets outside about:blank, forwards input and restores a checkpoint in a new worker", async () => {
  const first = content();
  const adapter = await mountMameWorker(config, frame.contentDocument!.body, frame.contentWindow!, null, first);
  expect(adapter.touchGamepad).toMatchObject({auxiliary: expect.arrayContaining([
    {index: 8, label: "投币", side: "center-left"}, {index: 9, label: "开始", side: "center-right"},
  ])});
  expect(fake.asset.mock.calls[0][0]).toMatch(/^https?:\/\/[^/]+\/provider\/$/u);
  expect(first.contentSession.materialize).not.toHaveBeenCalled();
  expect(fake.boot?.media[0]).toMatchObject({path: "sample/disk.chd", size: 4 * 1024 ** 3});
  expect(fake.boot?.assetBaseURL).toBe("https://provider.test/assets/mame/");
  frame.contentWindow!.dispatchEvent(new KeyboardEvent("keydown", {code: "ArrowLeft", key: "ArrowLeft", bubbles: true}));
  tick(17); await vi.waitFor(() => expect(fake.requests.some(item => item.command === "STEP")).toBe(true));
  const step = fake.requests.find(item => item.command === "STEP")!.payload as {events: unknown[]};
  expect(step.events.length).toBeGreaterThan(0);
  const checkpoint = await adapter.checkpoint!();
  expect(decodeWorkerState(await decodeState("a".repeat(64), "b".repeat(64), checkpoint.bytes)).native).toEqual(Uint8Array.of(1, 2, 3));
  await adapter.exit(); expect(first.close).toHaveBeenCalledOnce();
  const second = content();
  const restored = await mountMameWorker(config, frame.contentDocument!.body, frame.contentWindow!, checkpoint.bytes, second);
  expect(fake.boot?.restore).toEqual({native: Uint8Array.of(1, 2, 3), files: [{path: "diff/disk.dif", bytes: Uint8Array.of(9)}]});
  await restored.pause(); await restored.resume(); await restored.exit();
  expect(second.close).toHaveBeenCalledOnce(); expect(fake.close).toHaveBeenCalledTimes(2);
});
it("closes an opened disk if startup is cancelled before the worker boot", async () => {
  const controller = new AbortController(), input = content(controller.signal);
  fake.asset.mockImplementation(async () => {controller.abort(); throw new DOMException("cancelled", "AbortError");});
  await expect(mountMameWorker(config, frame.contentDocument!.body, frame.contentWindow!, null, input)).rejects.toThrow();
  expect(input.close).toHaveBeenCalledOnce(); expect(fake.close).toHaveBeenCalledOnce();
  expect(fake.requests.some(item => item.command === "BOOT")).toBe(false);
});
it("does not allocate a worker for an already cancelled launch", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(mountMameWorker(config, frame.contentDocument!.body, frame.contentWindow!, null, content(controller.signal))).rejects.toThrow();
  expect(fake.created).not.toHaveBeenCalled();
});
