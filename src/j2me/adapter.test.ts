// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {RuntimeStartupInteractionV1} from "../provider/module-api.js";
import {mountJ2me} from "./adapter.js";

type TestEvent = {type: string; code?: string; reason?: string; interaction?: RuntimeStartupInteractionV1 | null};
const config = {sessionId: "launch", contentDigest: "a".repeat(64), jarSizeBytes: 10,
  jarUrl: "http://localhost/content/game.jar", runtimeBaseUrl: "http://localhost/runtime/"};
const gamepads = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
beforeEach(() => {Object.defineProperty(navigator, "getGamepads", {configurable: true, value: () => []});});
afterEach(() => {
  if (gamepads) {Object.defineProperty(navigator, "getGamepads", gamepads);}
  else {Reflect.deleteProperty(navigator, "getGamepads");}
});
function fixture() {
  const target = document.createElement("div");
  let listener: (event: TestEvent) => void = () => undefined;
  const unsubscribe = vi.fn();
  const core = {mount: vi.fn(), exit: vi.fn(), pause: vi.fn(), resume: vi.fn(), screenshot: vi.fn(),
    getState: () => "RUNNING", setInput: vi.fn(), respondToStartupInteraction: vi.fn(),
    acknowledgeCheckpoint: vi.fn(async () => undefined),
    getCanvas: () => null, getFrameCount: () => 3, setVolume: vi.fn(),
    getCheckpointAvailability: () => ({available: true, blocker: null}),
    checkpoint: vi.fn(async () => ({format: "j2me-rms-bundle-v1", bytes: new Uint8Array([1, 2])})),
    subscribe: vi.fn((fn) => {listener = fn; return unsubscribe;})};
  const module = {runtimeAdapter: {adapterAbi: "j2me-rms", checkpointFormat: "j2me-rms-bundle-v1",
    automaticViewport: true}, createRuntime: vi.fn(() => core)};
  const onExit = vi.fn();
  const onFailure = vi.fn();
  return {target, core, module, onExit, onFailure, unsubscribe, emit: (event: TestEvent) => listener(event),
    mount: (restore: Uint8Array | null = null) => mountJ2me(config, target, window, restore, vi.fn(), onExit,
      onFailure, undefined, async () => module),
    startup: (choose: (value: RuntimeStartupInteractionV1) => Promise<string>, register: (session: {exit(): Promise<void>}) => void) =>
      mountJ2me(config, target, window, null, vi.fn(), onExit, onFailure, undefined, async () => module, undefined, choose, register)};
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
    expect(f.onFailure).toHaveBeenCalledWith(expect.objectContaining({message: "J2ME_RUNTIME_FAILED", category: "CORE"}));
    await adapter.exit();
    const failed = fixture(); failed.core.mount.mockRejectedValue(new Error("load failed"));
    await expect(failed.mount()).rejects.toThrow("load failed");
    expect(failed.core.exit).toHaveBeenCalledOnce();
  });
  it("forwards startup choices before READY and registers independent cancellation", async () => {
    const f = fixture();
    let answer: (id: string) => void = () => {};
    let ready: () => void = () => {};
    const choose = vi.fn(() => new Promise<string>(resolve => {answer = resolve;}));
    const register = vi.fn();
    const interaction = {id: "entry", title: "Choose", choices: [{id: "2", label: "Two"}, {id: "3", label: "Three"}]};
    f.core.mount.mockImplementation(() => {
      f.emit({type: "STARTUP_INTERACTION", interaction});
      return new Promise<void>(resolve => {ready = resolve;});
    });
    const mounting = f.startup(choose, register);
    await vi.waitFor(() => expect(choose).toHaveBeenCalledWith(interaction));
    expect(register).toHaveBeenCalledWith({exit: expect.any(Function)});
    expect(f.core.respondToStartupInteraction).not.toHaveBeenCalled();
    answer("3");
    await vi.waitFor(() => expect(f.core.respondToStartupInteraction).toHaveBeenCalledWith("entry", "3"));
    ready();
    const adapter = await mounting;
    f.emit({type: "FATAL_ERROR", code: "J2ME_STARTUP_FAILED", reason: "CONSTRUCTOR: missing MIDI API"});
    expect(f.onFailure).toHaveBeenCalledWith(expect.objectContaining({diagnostics: ["CONSTRUCTOR: missing MIDI API"]}));
    await adapter.exit();
  });
  it("rejects an incompatible ABI and oversized restores before creating a VM", async () => {
    const f = fixture(); f.module.runtimeAdapter.adapterAbi = "wrong";
    await expect(f.mount()).rejects.toThrow("J2ME_CORE_ABI_MISMATCH");
    await expect(f.mount(new Uint8Array(2 * 1024 * 1024 + 1))).rejects.toThrow("J2ME_RUNTIME_CONFIG_INVALID");
    expect(f.module.createRuntime).not.toHaveBeenCalled();
  });
});
