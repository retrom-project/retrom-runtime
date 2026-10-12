import {afterEach, expect, it, vi} from "vitest";
import {installContentAcceptance} from "./content-acceptance.js";
afterEach(() => {vi.useRealTimers(); Reflect.deleteProperty(window, "EJS_Runtime");});

it("keeps startup pending until the actual asynchronous core load accepts content", async () => {
  vi.useFakeTimers(); let receipt = 0;
  const bridge = installContentAcceptance(window);
  Reflect.set(window, "EJS_Runtime", async () => ({_retrom_content_load_result: () => receipt}));
  await Reflect.get(window, "EJS_Runtime")({});
  let accepted = false;
  const loading = bridge.wait(new AbortController().signal).then(() => {accepted = true;});
  await vi.advanceTimersByTimeAsync(100); expect(accepted).toBe(false);
  receipt = 1; await vi.advanceTimersByTimeAsync(20); await loading;
  expect(accepted).toBe(true); bridge.cleanup(); expect(vi.getTimerCount()).toBe(0);
});
it("copies the typed encrypted rejection and native diagnostics before cleanup", async () => {
  const bridge = installContentAcceptance(window);
  Reflect.set(window, "EJS_Runtime", async (config: {printErr(message: string): void}) => {
    config.printErr("Failed to determine system mode");
    return {_retrom_content_load_result: () => -2};
  });
  await Reflect.get(window, "EJS_Runtime")({});
  const error = await bridge.wait(new AbortController().signal).catch(error => error);
  bridge.cleanup(); expect(error).toMatchObject({code: "PLAYER_CONTENT_ENCRYPTED", category: "CONTENT", diagnostics: ["Failed to determine system mode"]});
});
it("rejects missing ABI and cancels polling on exit", async () => {
  vi.useFakeTimers(); const bridge = installContentAcceptance(window);
  await expect(bridge.wait(new AbortController().signal)).rejects.toThrow("PLAYER_CONTENT_RECEIPT_UNAVAILABLE");
  Reflect.set(window, "EJS_Runtime", async () => ({_retrom_content_load_result: () => 0}));
  await Reflect.get(window, "EJS_Runtime")({});
  const promise = bridge.wait(new AbortController().signal);
  const canceled = expect(promise).rejects.toThrow("PLAYER_SESSION_ENDED"); bridge.cleanup(); await canceled;
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps a native content error when ordinary frontend option notices follow it", async () => {
  const bridge = installContentAcceptance(window);
  Reflect.set(window, "EJS_Runtime", async (config: {printErr(message: string): void}) => {
    config.printErr("[libretro ERROR] Cannot read the disc sector");
    for (let index = 0; index < 10; index++) {
      config.printErr(`invalid core option frontend-${index}. This is not an error.`);
      config.printErr("[INFO] Setting real canvas size: 1280 x 800");
    }
    return {_retrom_content_load_result: () => -1};
  });
  await Reflect.get(window, "EJS_Runtime")({});
  const error = await bridge.wait(new AbortController().signal).catch(error => error);
  bridge.cleanup();
  expect(error).toMatchObject({diagnostics: ["[libretro ERROR] Cannot read the disc sector"]});
});

it("reports a native failure after startup and stops watching on exit", async () => {
  vi.useFakeTimers(); let receipt = 1;
  const bridge = installContentAcceptance(window), failure = vi.fn();
  Reflect.set(window, "EJS_Runtime", async () => ({_retrom_content_load_result: () => receipt}));
  await Reflect.get(window, "EJS_Runtime")({});
  await bridge.wait(new AbortController().signal);
  bridge.monitor(new AbortController().signal, failure);
  await vi.advanceTimersByTimeAsync(250); expect(failure).not.toHaveBeenCalled();
  receipt = -1; await vi.advanceTimersByTimeAsync(250);
  expect(failure).toHaveBeenCalledWith(expect.objectContaining({code: "PLAYER_CONTENT_REJECTED"}));
  bridge.cleanup(); expect(vi.getTimerCount()).toBe(0);
});
