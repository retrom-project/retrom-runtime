import {describe, expect, it, vi} from "vitest";
import {readPspNativeState, readPspCheckpoint, restorePspCheckpoint} from "./psp-state.js";
const loaded = () => ({promise: Promise.resolve(), cancel: vi.fn()});
describe("pinned PSP native state allocation", () => {
  it("keeps the restore file and main loop paused until native loading completes", async () => {
    let finish!: (result: number) => void;
    const load = vi.fn(() => new Promise<number>((resolve) => {finish = resolve;}));
    const module = {HEAPU8: new Uint8Array(128), UTF8ToString: () => "3|64|1", _free: vi.fn(),
      cwrap: vi.fn((name: string) => name === "load_state" ? load : async () => 24)};
    const manager = {Module: module, FS: {writeFile: vi.fn(), unlink: vi.fn()}, toggleMainLoop: vi.fn(), clearEJSResetTimer: vi.fn()};
    const bytes = Uint8Array.of(1, 2, 3);
    const pending = restorePspCheckpoint(manager, bytes, 128, loaded);
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith("/game.state", 0));
    expect(module.cwrap).toHaveBeenCalledWith("load_state", "number", ["string", "number"], {async: true});
    expect(manager.FS.writeFile).toHaveBeenCalledWith("/game.state", bytes);
    expect(manager.toggleMainLoop.mock.calls).toEqual([[false]]);
    finish(0); await pending;
    expect(manager.FS.unlink).toHaveBeenCalledWith("/game.state");
  });
  it("lets startup advance until the core can serialize before loading", async () => {
    const serialize = vi.fn().mockResolvedValueOnce(0).mockResolvedValue(24);
    const load = vi.fn(async () => 0);
    const manager = {Module: {HEAPU8: new Uint8Array(128), UTF8ToString: () => "3|64|1", _free: vi.fn(),
      cwrap: (name: string) => name === "load_state" ? load : serialize},
      FS: {writeFile: vi.fn(), unlink: vi.fn()}, toggleMainLoop: vi.fn()};
    await restorePspCheckpoint(manager, Uint8Array.of(1), 128, loaded);
    expect(serialize).toHaveBeenCalledTimes(2);
    expect(manager.toggleMainLoop.mock.calls).toEqual([[false], [true], [false], [true], [false]]);
    expect(load).toHaveBeenCalledOnce();
  });
  it.each([false, true])("waits for serialization before restoring paused=%s", async (paused) => {
    let finish!: (pointer: number) => void;
    const cwrap = vi.fn(() => () => new Promise<number>((resolve) => {finish = resolve;}));
    const manager = {toggleMainLoop: vi.fn(), Module: {
      cwrap, HEAPU8: new Uint8Array(128), UTF8ToString: () => "3|64|1", _free: vi.fn(),
    }};
    const pending = readPspCheckpoint(manager, 128, paused);
    expect(cwrap).toHaveBeenCalledWith("save_state_info", "number", [], {async: true});
    expect(manager.toggleMainLoop.mock.calls).toEqual([[false]]);
    finish(24); await pending;
    expect(manager.toggleMainLoop.mock.calls).toEqual([[false], [!paused]]);
  });
  it("copies before freeing the payload and never frees the borrowed descriptor", async () => {
    const heap = new Uint8Array(128); heap.set([7, 8, 9], 64);
    const free = vi.fn((pointer: number) => {heap.fill(0, pointer);});
    const state = await readPspNativeState({HEAPU8: heap, UTF8ToString: () => "3|64|1", _free: free, cwrap: () => async () => 24}, 128);
    expect(state).toEqual(Uint8Array.of(7, 8, 9)); expect(free).toHaveBeenCalledExactlyOnceWith(64);
  });
  it("uses the grown heap after native serialization", async () => {
    const grown = new Uint8Array(256); grown.set([3, 4], 192);
    const module = {HEAPU8: new Uint8Array(128), UTF8ToString: () => "2|192|1", _free: vi.fn(), cwrap: () => async () => {module.HEAPU8 = grown; return 24;}};
    expect(await readPspNativeState(module, 256)).toEqual(Uint8Array.of(3, 4));
  });
  it("rejects oversized data while releasing its valid allocation", async () => {
    const free = vi.fn();
    await expect(readPspNativeState({HEAPU8: new Uint8Array(128), UTF8ToString: () => "3|64|1", _free: free, cwrap: () => async () => 24}, 2)).rejects.toThrow("PLAYER_STATE_UNAVAILABLE");
    expect(free).toHaveBeenCalledExactlyOnceWith(64);
  });
});
