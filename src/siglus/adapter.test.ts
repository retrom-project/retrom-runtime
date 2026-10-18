import {afterEach, expect, it, vi} from "vitest";
import {mountSiglus} from "./adapter.js";
import {SiglusContent} from "./content.js";
import {loadCoreModule} from "../provider/core-module.js";
import {encodeSiglusSave, siglusSaveFormat, type SiglusSnapshot} from "./checkpoint.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";

vi.mock("../provider/core-module.js", () => ({loadCoreModule: vi.fn()}));
vi.mock("./content.js", () => ({SiglusContent: vi.fn()}));
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();});
const parameters = {contentDigest: "a".repeat(64), projectIndexURL: "http://localhost/index.json",
  language: "chs" as const, runtimeBaseURL: "http://localhost/core/"};
const snapshot = (): SiglusSnapshot => ({format: "siglus-save-files", version: 1,
  scope: `${parameters.contentDigest}:chs`, files: [{path: "savedata/0000.sav", data: "AQID"}]});
function fixture() {
  let revision = "1", acknowledged = "0", progress = true;
  const game = {frames: () => 42, status: () => ({progress, revision, changed: revision !== acknowledged}),
    acknowledge: vi.fn((captured: string) => {if (revision === captured) {acknowledged = captured;}}),
    export: vi.fn(async () => ({snapshot: snapshot(), revision})), pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}), close: vi.fn(async () => {}), volume: vi.fn()};
  const create = vi.fn(async (_options: unknown) => game), closeModule = vi.fn(), closeContent = vi.fn(async () => {});
  vi.mocked(SiglusContent).mockImplementation(function () {return {project: vi.fn(async () => []), read: vi.fn(), close: closeContent} as unknown as SiglusContent;});
  vi.mocked(loadCoreModule).mockResolvedValue({module: {abi: "siglus-host-v1", create},
    assets: {"siglus_bg.wasm": "blob:verified-wasm"}, close: closeModule});
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const content = {assetIndex: {}, contentSession: {}, onFailure: vi.fn(), signal: new AbortController().signal} as unknown as AdapterContentOptions;
  const mount = (restore: Uint8Array | null = null) => mountSiglus(parameters, document.body, window, restore, content, vi.fn());
  return {game, create, closeContent, closeModule, mount, setRevision: (value: string) => {revision = value;},
    noSave: () => {progress = false;}};
}
it("imports authorized native progress before initialization and exposes explicit in-game capture/load semantics", async () => {
  const f = fixture(), adapter = await f.mount(encodeSiglusSave(snapshot(), snapshot().scope));
  try {
    expect(f.create.mock.calls[0]?.[0]).toMatchObject({restore: snapshot(), wasmURL: "blob:verified-wasm"});
    expect(adapter.getCheckpointAvailability()).toMatchObject({available: true, save: {capture: "IN_GAME", restore: "IN_GAME"}});
    await adapter.pause(); await adapter.resume();
    expect(f.game.pause).toHaveBeenCalledOnce(); expect(f.game.resume).toHaveBeenCalledOnce();
  } finally {await adapter.exit();}
  expect(f.game.close).toHaveBeenCalledOnce(); expect(f.closeModule).toHaveBeenCalledOnce(); expect(f.closeContent).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-gamepad-cursor]")).toBeNull();
});
it("acknowledges only persisted matching bytes after public gzip makes a copy, preserving subsequent changes", async () => {
  const f = fixture(), adapter = await f.mount();
  try {
    const checkpoint = await adapter.checkpoint();
    expect(checkpoint.format).toBe(siglusSaveFormat);
    expect(f.game.acknowledge).not.toHaveBeenCalled();
    f.setRevision("2");
    await adapter.acknowledgeCheckpoint?.({...checkpoint, bytes: checkpoint.bytes.slice()});
    expect(f.game.acknowledge).toHaveBeenLastCalledWith("1");
    expect(adapter.getCheckpointAvailability()).toMatchObject({available: true, revision: "2"});
    const latest = await adapter.checkpoint(); await adapter.acknowledgeCheckpoint?.({...latest, bytes: latest.bytes.slice()});
    expect(adapter.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  } finally {await adapter.exit();}
});
it("never offers settings-only data as progress and cleans verified assets after core initialization failure", async () => {
  const f = fixture(); f.noSave(); const adapter = await f.mount();
  expect(adapter.getCheckpointAvailability()).toMatchObject({available: false, blocker: "NO_SAVE"});
  await adapter.exit(); await adapter.exit(); expect(f.closeContent).toHaveBeenCalledOnce();
  f.create.mockRejectedValueOnce(new Error("initialization failed"));
  await expect(f.mount()).rejects.toThrow("initialization failed");
  expect(f.closeModule).toHaveBeenCalledTimes(2); expect(document.querySelector("canvas")).toBeNull();
});

it("cancels Content I/O before awaiting a core suspended inside a read", async () => {
  const f = fixture(), adapter = await f.mount();
  let resume!: () => void;
  const reading = new Promise<void>(resolve => {resume = resolve;});
  f.game.close.mockImplementation(async () => {await reading;});
  f.closeContent.mockImplementation(async () => {resume();});
  const exit = adapter.exit();
  try {expect(f.closeContent).toHaveBeenCalledOnce();}
  finally {resume(); await exit;}
  expect(f.game.close).toHaveBeenCalledOnce(); expect(f.closeModule).toHaveBeenCalledOnce();
});
