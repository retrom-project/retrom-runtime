import {afterEach, expect, it, vi} from "vitest";
import {installAzaharStateRestore} from "./azahar-state.js";
afterEach(() => {vi.useRealTimers(); Reflect.deleteProperty(window, "EJS_GameManager");});

it.each([1, -1])("waits for actual native restore receipt %s instead of startup or loading logs", async (outcome) => {
  vi.useFakeTimers(); let receipt = 0, frame = 0;
  const cleanup = installAzaharStateRestore(window), writes: number[] = [];
  const unlink = vi.fn();
  class Manager {
    Module = {_retrom_state_load_begin: () => {receipt = 0;}, _retrom_state_load_result: () => receipt};
    FS = {writeFile: () => {writes.push(frame);}, unlink};
    functions = {loadState: () => {window.setTimeout(() => {receipt = outcome;}, 100);}};
    getFrameNum() {return frame;}
    toggleMainLoop(running: boolean) {if (running && !frame) {window.setTimeout(() => {frame = 1;}, 10);}}
  }
  Reflect.set(window, "EJS_GameManager", Manager);
  const manager = new Manager() as Manager & {loadExplicitStateAndWait: (bytes: Uint8Array) => Promise<void>};
  const pending = manager.loadExplicitStateAndWait(Uint8Array.of(1)); let done = false;
  void pending.then(() => {done = true;}, () => {done = true;});
  const result = outcome === 1 ? expect(pending).resolves.toBeUndefined()
    : expect(pending).rejects.toThrow("PLAYER_SAVE_STATE_RESTORE_FAILED");
  await vi.advanceTimersByTimeAsync(60); expect(done).toBe(false); expect(writes).toEqual([1]);
  await vi.runAllTimersAsync(); await result; expect(unlink).toHaveBeenCalledWith("/game.state");
  cleanup(); expect(vi.getTimerCount()).toBe(0);
});
it("cancels a pending native restore and restores the manager prototype", async () => {
  vi.useFakeTimers(); const cleanup = installAzaharStateRestore(window);
  class Manager {
    Module = {_retrom_state_load_begin: vi.fn(), _retrom_state_load_result: () => 0};
    FS = {writeFile: vi.fn(), unlink: vi.fn()}; functions = {loadState: vi.fn()};
    getFrameNum() {return 1;} toggleMainLoop = vi.fn();
  }
  Reflect.set(window, "EJS_GameManager", Manager);
  const manager = new Manager() as Manager & {loadExplicitStateAndWait: (bytes: Uint8Array) => Promise<void>};
  const pending = expect(manager.loadExplicitStateAndWait(Uint8Array.of(1))).rejects.toThrow("PLAYER_SESSION_ENDED");
  await vi.advanceTimersByTimeAsync(20); cleanup(); await pending;
  expect(manager.toggleMainLoop).toHaveBeenLastCalledWith(false);
  expect(Reflect.has(Manager.prototype, "loadExplicitStateAndWait")).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
