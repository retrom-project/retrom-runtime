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
