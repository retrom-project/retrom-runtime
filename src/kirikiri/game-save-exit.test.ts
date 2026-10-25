import {afterEach, expect, it, vi} from "vitest";
import {currentWindowHost, deferred} from "../../tests/provider-adapter-fixture.js";
import {config, enableRuntimeFeatures, fakeVlfs, loadCore, loadVlfs, mockDownloads, type HostWindow} from "../../tests/kirikiri-adapter-fixture.js";
import {createRuntime} from "../index.js";
import type {RuntimeEventV1} from "../provider/module-api.js";
import {decodeStoredCheckpoint} from "../provider/checkpoint-storage.js";
import {decodeKirikiriCheckpoint, maximumKirikiriCheckpointBytes} from "./checkpoint.js";
import {suspendingBookmark, type KirikiriJspi} from "../../tests/kirikiri-checkpoint-fixture.js";

const actualWasm = window.WebAssembly as KirikiriJspi;
const actualJspi = {promising: actualWasm.promising, Suspending: actualWasm.Suspending};

vi.mock("./content.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./content.js")>();
  return {...actual, KirikiriContent: class extends actual.KirikiriContent {
    override async assets(base: URL) {
      return {vlfsUrl: new URL("vlfs.js", base).href, scriptUrl: new URL("index.js", base).href,
        wasmUrl: "blob:kirikiri-verified-wasm", archive: new Blob([Uint8Array.of(1)])};
    }
  }};
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  Object.defineProperty(actualWasm, "promising", {configurable: true, value: actualJspi.promising});
  Object.defineProperty(actualWasm, "Suspending", {configurable: true, value: actualJspi.Suspending});
  delete (window as HostWindow).Module; delete (window as HostWindow).VLFS;
  document.head.querySelectorAll("script[data-runtime=kirikiri2]").forEach(script => script.remove());
  document.body.replaceChildren();
});

it("exports unsynced native files once on normal exit through the public single-gzip final snapshot", async () => {
  const f = await mount(); nativeSave(f, Uint8Array.of(4, 2));
  f.vlfs.onWriteClose?.("/profiles/玩家/options.ksd", Uint8Array.of(7));
  try {
    f.module.onExit?.(0); f.module.onExit?.(0);
    expect(f.module.pauseMainLoop).not.toHaveBeenCalled(); // Never reenter Wasm from onExit.
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("EXITED"));
    const exits = f.events.filter(event => event.type === "EXIT_REQUESTED");
    expect(exits).toHaveLength(1);
    const snapshot = exits[0]?.type === "EXIT_REQUESTED" ? exits[0].finalSnapshot : undefined;
    expect(snapshot).toBeDefined();
    expect(snapshot!.checkpoint.format).toBe("kirikiri-game-save-v1-storage-v1");
    const native = await decodeStoredCheckpoint(snapshot!.checkpoint.bytes, snapshot!.checkpoint.format, maximumKirikiriCheckpointBytes);
    expect(await decodeKirikiriCheckpoint(native)).toEqual({progressPaths: ["profiles/玩家/slot.png"], entries: [
      {path: "profiles/玩家/options.ksd", data: Uint8Array.of(7)},
      {path: "profiles/玩家/slot.png", data: Uint8Array.of(4, 2)},
    ]});
    expect(snapshot!.screenshot?.size).toBeGreaterThan(0);
    expect(f.module.resumeMainLoop).not.toHaveBeenCalled();
    expect(f.module._krkr2_host_save_bookmark).not.toHaveBeenCalled();
    expect(f.module._krkr2_host_load_bookmark).not.toHaveBeenCalled();
    expect(f.module.krkr2StopMainLoop).toHaveBeenCalledOnce();
  } finally {await f.runtime.exit();}
});

it("drains the confirmed native exit before exporting its last writes and stops polling the KAG observer", async () => {
  const f = await mount(), closing = deferred<void>();
  nativeSave(f, Uint8Array.of(1));
  f.module._krkr2_host_finalize_native_exit.mockImplementation(async () => {
    await closing.promise;
    f.vlfs.onWriteClose?.("/profiles/玩家/options.ksd", Uint8Array.of(7));
    return 0;
  });
  try {
    f.module.onNativeExitRequested?.(0); f.module.onNativeExitRequested?.(0);
    expect(f.module._krkr2_host_finalize_native_exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.module._krkr2_host_finalize_native_exit).toHaveBeenCalledOnce());
    f.module._krkr2_host_observe_game_saves.mockReturnValue(-3);
    expect(f.runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "NOT_READY"});
    expect(f.events.some(event => event.type === "EXIT_REQUESTED")).toBe(false);
    expect((window as HostWindow).VLFS).toBe(f.vlfs);
    closing.resolve();
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("EXITED"));
    const exits = f.events.filter(event => event.type === "EXIT_REQUESTED");
    expect(exits).toHaveLength(1);
    const snapshot = exits[0]?.type === "EXIT_REQUESTED" ? exits[0].finalSnapshot : undefined;
    const bytes = await decodeStoredCheckpoint(snapshot!.checkpoint.bytes, snapshot!.checkpoint.format, maximumKirikiriCheckpointBytes);
    expect((await decodeKirikiriCheckpoint(bytes)).entries).toEqual([
      {path: "profiles/玩家/options.ksd", data: Uint8Array.of(7)},
      {path: "profiles/玩家/slot.png", data: Uint8Array.of(1)},
    ]);
    expect(f.module.resumeMainLoop).not.toHaveBeenCalled();
    expect(f.module._krkr2_host_save_bookmark).not.toHaveBeenCalled();
    expect(f.module._krkr2_host_load_bookmark).not.toHaveBeenCalled();
  } finally {closing.resolve(); await f.runtime.exit();}
});

it.each(["failed-finalize", "nonzero"])("preserves a real %s failure on confirmed native exit", async mode => {
  const f = await mount(); nativeSave(f, Uint8Array.of(4, 2));
  f.module._krkr2_host_finalize_native_exit.mockResolvedValue(-5);
  try {
    f.module.onNativeExitRequested?.(mode === "nonzero" ? 9 : 0);
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("FAILED"));
    expect(f.events.some(event => event.type === "EXIT_REQUESTED")).toBe(false);
    expect(f.events.filter(event => event.type === "FATAL_ERROR")).toEqual([
      expect.objectContaining({failure: expect.objectContaining({code: mode === "nonzero"
        ? "KIRIKIRI_RUNTIME_EXIT_FAILED" : "KIRIKIRI_GAME_SAVE_FINAL_EXPORT_FAILED"})}),
    ]);
  } finally {await f.runtime.exit();}
});

it("finalizes a native exit with no progress without fabricating a save", async () => {
  const f = await mount();
  try {
    f.module.onNativeExitRequested?.(0);
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("EXITED"));
    expect(f.module._krkr2_host_finalize_native_exit).toHaveBeenCalledOnce();
    expect(f.events.filter(event => event.type === "EXIT_REQUESTED")).toEqual([{type: "EXIT_REQUESTED"}]);
  } finally {await f.runtime.exit();}
});

it("waits for the original native tick and final complete write before reporting exit", async () => {
  const f = await mount(), tick = deferred<void>();
  f.module.pauseMainLoop.mockReturnValueOnce(tick.promise);
  f.module.onGameSave?.({phase: "begin", id: 1});
  f.vlfs.onWriteClose?.("/profiles/玩家/slot.png", Uint8Array.of(1));
  try {
    f.module.onExit?.(0);
    await vi.waitFor(() => expect(f.module.pauseMainLoop).toHaveBeenCalledOnce());
    expect(f.events.some(event => event.type === "EXIT_REQUESTED")).toBe(false);
    expect(f.module.krkr2StopMainLoop).not.toHaveBeenCalled();
    expect((window as HostWindow).Module).toBe(f.module);
    f.vlfs.onWriteClose?.("/profiles/玩家/slot.png", Uint8Array.of(1, 2, 3, 4));
    f.module.onGameSave?.({phase: "end", id: 1, success: true}); tick.resolve();
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("EXITED"));
    const exit = f.events.find(event => event.type === "EXIT_REQUESTED");
    const saved = exit?.type === "EXIT_REQUESTED" ? exit.finalSnapshot?.checkpoint : undefined;
    expect(saved).toBeDefined();
    const bytes = await decodeStoredCheckpoint(saved!.bytes, saved!.format, maximumKirikiriCheckpointBytes);
    expect((await decodeKirikiriCheckpoint(bytes)).entries[0]?.data).toEqual(Uint8Array.of(1, 2, 3, 4));
  } finally {tick.resolve(); await f.runtime.exit();}
});

it.each(["normal", "native", "host-stop"])("retains a real suspended Wasm tick during final %s", async mode => {
  const f = await mount(), reading = deferred<void>();
  Object.defineProperty(actualWasm, "promising", {configurable: true, value: actualJspi.promising});
  Object.defineProperty(actualWasm, "Suspending", {configurable: true, value: actualJspi.Suspending});
  let insideCallback = false;
  const run = actualWasm.promising(suspendingBookmark(actualWasm, () => {
    f.module.onGameSave?.({phase: "begin", id: 1});
    insideCallback = true;
    if (mode === "native") {f.module.onNativeExitRequested?.(0);} else {f.module.onExit?.(0);}
    insideCallback = false;
    return reading.promise.then(() => {
      f.vlfs.onWriteClose?.("/profiles/玩家/slot.png", Uint8Array.of(4, 2));
      f.module.onGameSave?.({phase: "end", id: 1, success: true});
    }, error => {
      f.module.onGameSave?.({phase: "end", id: 1, success: false}); throw error;
    });
  }));
  f.module.pauseMainLoop.mockImplementation(async () => {
    expect(insideCallback).toBe(false); expect(tick).toBeDefined(); await tick;
  });
  f.module.krkr2StopMainLoop.mockImplementation(async (active?: Promise<unknown>) => {
    await Promise.allSettled([tick, active]);
  });
  const tick = run(0), result = tick.catch(error => error as Error);
  try {
    await vi.waitFor(() => expect(f.module.pauseMainLoop).toHaveBeenCalledOnce());
    expect((window as HostWindow).Module).toBe(f.module);
    expect(f.events.some(event => event.type === "EXIT_REQUESTED")).toBe(false);
    expect(f.module._krkr2_host_finalize_native_exit).not.toHaveBeenCalled();
    if (mode !== "host-stop") {
      reading.resolve(); expect(await result).toBe(0);
      await vi.waitFor(() => expect(f.runtime.getState()).toBe("EXITED"));
      expect(f.events.find(event => event.type === "EXIT_REQUESTED")).toMatchObject({
        finalSnapshot: {checkpoint: {format: "kirikiri-game-save-v1-storage-v1"}},
      });
      expect(f.module._krkr2_host_finalize_native_exit).toHaveBeenCalledTimes(mode === "native" ? 1 : 0);
    } else {
      let closed = false;
      const stopping = f.runtime.exit(); void stopping.then(() => {closed = true;});
      await vi.waitFor(() => expect(f.module.krkr2StopMainLoop).toHaveBeenCalledOnce());
      expect(closed).toBe(false); expect((window as HostWindow).VLFS).toBe(f.vlfs);
      reading.reject(Object.assign(new Error("read canceled"), {code: "CONTENT_IO_ABORTED"}));
      await result; await stopping;
      expect(f.events.some(event => event.type === "EXIT_REQUESTED")).toBe(false);
    }
    expect((window as HostWindow).Module).toBeUndefined();
    expect(f.module.resumeMainLoop).not.toHaveBeenCalled();
  } finally {reading.resolve(); await result; await f.runtime.exit();}
});

it.each(["no-progress", "acknowledged"])("does not fabricate a final save for %s", async mode => {
  const f = await mount();
  if (mode === "acknowledged") {
    nativeSave(f, Uint8Array.of(4, 2));
    const saved = await f.runtime.checkpoint(); await f.runtime.acknowledgeCheckpoint!(saved);
  } else {f.vlfs.onWriteClose?.("/settings.ksd", Uint8Array.of(7));}
  f.module.pauseMainLoop.mockClear(); f.module.resumeMainLoop.mockClear();
  try {
    f.module.onExit?.(0);
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("EXITED"));
    expect(f.events.filter(event => event.type === "EXIT_REQUESTED")).toEqual([{type: "EXIT_REQUESTED"}]);
    expect(f.module.pauseMainLoop).toHaveBeenCalled();
    expect(f.module.resumeMainLoop).not.toHaveBeenCalled();
    expect(f.screenshot).not.toHaveBeenCalled();
  } finally {await f.runtime.exit();}
});

it.each(["null", "throw", "empty", "oversized"])("keeps valid final progress when screenshot is %s", async mode => {
  const f = await mount(); nativeSave(f, Uint8Array.of(4, 2));
  f.screenshot.mockImplementation(callback => {
    if (mode === "throw") {throw new Error("screenshot unavailable");}
    callback(mode === "null" ? null : new Blob([new Uint8Array(mode === "empty" ? 0 : 16 * 1024 * 1024 + 1)], {type: "image/png"}));
  });
  try {
    f.module.onExit?.(0);
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("EXITED"));
    const exit = f.events.find(event => event.type === "EXIT_REQUESTED");
    expect(exit).toMatchObject({type: "EXIT_REQUESTED", finalSnapshot: {screenshot: null,
      checkpoint: {format: "kirikiri-game-save-v1-storage-v1"}}});
    expect(f.events.some(event => event.type === "FATAL_ERROR")).toBe(false);
  } finally {await f.runtime.exit();}
});

it.each(["failed-save", "pending-save", "oversized-file"])("rejects %s on exit without publishing a replacement", async mode => {
  const f = await mount(); nativeSave(f, Uint8Array.of(4, 2));
  if (mode === "oversized-file") {
    f.vlfs.onWriteClose?.("/large.bin", new Uint8Array(maximumKirikiriCheckpointBytes + 1));
  } else {
    f.module.onGameSave?.({phase: "begin", id: 2});
    f.vlfs.onWriteClose?.("/profiles/玩家/slot.png", Uint8Array.of(9));
    if (mode === "failed-save") {f.module.onGameSave?.({phase: "end", id: 2, success: false});}
  }
  try {
    f.module.onExit?.(0);
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("FAILED"));
    expect(f.events.filter(event => event.type === "FATAL_ERROR")).toEqual([
      expect.objectContaining({failure: expect.objectContaining({code: "KIRIKIRI_GAME_SAVE_FINAL_EXPORT_FAILED"})}),
    ]);
    expect(f.events.some(event => event.type === "EXIT_REQUESTED")).toBe(false);
    expect(f.module.resumeMainLoop).not.toHaveBeenCalled();
    await vi.waitFor(() => expect((window as HostWindow).VLFS).toBeUndefined());
  } finally {await f.runtime.exit();}
});

it.each(["abort", "nonzero", "trap"])("keeps %s as a failure even after an earlier exit(0) signal", async mode => {
  const f = await mount(); nativeSave(f, Uint8Array.of(4, 2));
  try {
    f.module.onExit?.(0);
    if (mode === "abort") {f.module.onAbort?.("core aborted");}
    else if (mode === "nonzero") {f.module.onExit?.(9);}
    else {
      const error = new WebAssembly.RuntimeError("unreachable");
      error.stack = "RuntimeError: unreachable\n at blob:kirikiri-verified-wasm:wasm-function[17]:0x100";
      window.dispatchEvent(new ErrorEvent("error", {error, message: error.message, cancelable: true}));
    }
    await vi.waitFor(() => expect(f.runtime.getState()).toBe("FAILED"));
    const code = mode === "abort" ? "KIRIKIRI_RUNTIME_ABORTED" : mode === "nonzero" ? "KIRIKIRI_RUNTIME_EXIT_FAILED" : "KIRIKIRI_RUNTIME_TRAP";
    expect(f.events.filter(event => event.type === "FATAL_ERROR")).toEqual([
      expect.objectContaining({failure: expect.objectContaining({code})}),
    ]);
    expect(f.events.some(event => event.type === "EXIT_REQUESTED")).toBe(false);
  } finally {await f.runtime.exit();}
});

async function mount() {
  enableRuntimeFeatures(); mockDownloads();
  const screenshot = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => {
    callback(new Blob([Uint8Array.of(1, 2, 3)], {type: "image/png"}));
  });
  const vlfs = fakeVlfs(), runtime = await createRuntime(config(), currentWindowHost(null));
  const events: RuntimeEventV1[] = []; runtime.subscribe(event => events.push(event));
  const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
  const module = await loadCore(vlfs); await mounting;
  return {vlfs, runtime, module, events, screenshot};
}

function nativeSave(f: Awaited<ReturnType<typeof mount>>, bytes: Uint8Array) {
  f.module.onGameSave?.({phase: "begin", id: 1});
  f.vlfs.onWriteClose?.("/profiles/玩家/slot.png", bytes);
  f.module.onGameSave?.({phase: "end", id: 1, success: true});
}
