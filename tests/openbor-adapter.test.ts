import {runInNewContext} from "node:vm";
import {afterEach, expect, it, vi} from "vitest";
import {mountOpenBOR} from "../src/openbor/adapter.js";
import {encodeSave} from "../src/openbor/save.js";
const mocks = vi.hoisted(() => ({factory: vi.fn(), fetch: vi.fn(), dispose: vi.fn()}));
vi.mock("../src/openbor/module.js", () => ({loadModule: async () => mocks.factory}));
vi.mock("../src/openbor/fetch.js", () => ({fetchPak: mocks.fetch}));
vi.mock("../src/openbor/input.js", () => ({installInput: () => ({dispose: mocks.dispose, pause: vi.fn(), resume: vi.fn()})}));
afterEach(() => {vi.clearAllMocks(); document.body.replaceChildren();});
it("copies PAK and restored files into the core realm before native startup", async () => {
  const foreign = runInNewContext("({Uint8Array, ArrayBuffer})") as typeof globalThis;
  const realm = Object.create(window) as Window;
  Object.defineProperty(realm, "Uint8Array", {value: foreign.Uint8Array});
  const target = document.createElement("div"); document.body.append(target);
  const writes = new Map<string, Uint8Array>();
  const fs = {mkdirTree: vi.fn(), writeFile: (path: string, data: Uint8Array) => {
    if (!(data.buffer instanceof foreign.ArrayBuffer)) {throw new Error("Unsupported data type");}
    writes.set(path, data);
  }, readdir: (path: string) => [...writes.keys()].filter(name => name.startsWith(path + "/")).map(name => name.slice(path.length + 1)),
  readFile: (path: string) => writes.get(path)!, stat: (path: string) => ({size: writes.get(path)!.length, mode: 1}),
  isFile: (mode: number) => mode === 1};
  let onExit = () => undefined, stopRequested = false;
  const core = {FS: fs, retromAbi: "openbor-host-v1", retromFrames: 2, retromKeys: [],
    retromStopped: false, retromStop: () => {stopRequested = true;}, retromDispose: vi.fn().mockResolvedValue(undefined), retromSetPaused: vi.fn().mockResolvedValue(undefined),
    callMain: vi.fn(() => {expect([...writes.keys()]).toEqual(["/Paks/game.pak", "/Saves/game.sav"]);})};
  mocks.factory.mockImplementation(async (options) => {onExit = options.onExit; return core;}); mocks.fetch.mockResolvedValue(Uint8Array.of(1, 2, 3));
  const identity = "a".repeat(64);
  const runtime = await mountOpenBOR({pak: {url: "/game.pak", sizeBytes: 3, sha256: identity}, runtimeBaseUrl: "/assets/"},
    target, realm, encodeSave(identity, [["game.sav", Uint8Array.of(4, 5)]]), vi.fn(), vi.fn());
  expect(core.callMain).toHaveBeenCalledWith(["/Paks/game.pak"]);
  expect(Array.from(writes.get("/Saves/game.sav")!)).toEqual([4, 5]);
  expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  fs.writeFile("/Saves/game.sav", new foreign.Uint8Array([6, 7]));
  expect(runtime.getCheckpointAvailability()).toMatchObject({available: true, save: {dataKind: "PROGRESS"}});
  const checkpoint = await runtime.checkpoint();
  await runtime.acknowledgeCheckpoint?.(checkpoint);
  expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  const exiting = runtime.exit();
  expect(runtime.exit()).toBe(exiting); expect(stopRequested).toBe(true);
  expect(core.retromDispose).not.toHaveBeenCalled();
  onExit(); await exiting;
  expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, blocker: "NOT_READY"});
  expect(mocks.dispose).toHaveBeenCalledOnce(); expect(core.retromDispose).toHaveBeenCalledOnce(); expect(target.children).toHaveLength(0);
});
