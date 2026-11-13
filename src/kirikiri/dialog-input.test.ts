import {afterEach, expect, it, vi} from "vitest";
import {installKirikiriDialogInput} from "./dialog-input.js";

afterEach(() => vi.useRealTimers());
it("pauses the startup deadline while the user reads a modal, then resumes the remaining budget", async () => {
  vi.useFakeTimers({toFake: ["performance", "setTimeout", "clearTimeout"]});
  const input = installKirikiriDialogInput(window, () => {});
  const pending = input.waitForReady(new Promise<void>(() => {}), new AbortController().signal, 60_000);
  const rejected = expect(pending).rejects.toThrow("KIRIKIRI_RUNTIME_TIMEOUT");
  await vi.advanceTimersByTimeAsync(10_000);
  input.onConfirmDialogChanged(true);
  await vi.advanceTimersByTimeAsync(120_000);
  input.onConfirmDialogChanged(false);
  await vi.advanceTimersByTimeAsync(49_999);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await rejected; input.finishStartup();
});
it("cancels a pending startup wait even with a modal open", async () => {
  const input = installKirikiriDialogInput(window, () => {}), abort = new AbortController();
  input.onConfirmDialogChanged(true);
  const pending = input.waitForReady(new Promise<void>(() => {}), abort.signal, 60_000);
  abort.abort();
  await expect(pending).rejects.toThrow("ABORTED"); input.finishStartup();
});
