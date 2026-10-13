import {afterEach, expect, it, vi} from "vitest";
import {waitForOnsEngine} from "./startup.js";
afterEach(() => vi.useRealTimers());

it("waits for slow content reads without consuming the native initialization deadline", async () => {
  vi.useFakeTimers();
  let reading = true, ready = false;
  const done = vi.fn();
  const pending = waitForOnsEngine(Promise.resolve(), () => ready, () => reading).then(done);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(done).not.toHaveBeenCalled();
  reading = false; ready = true;
  await vi.advanceTimersByTimeAsync(10); await pending;
  expect(done).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("still rejects stalled native initialization and cancels its poller", async () => {
  vi.useFakeTimers();
  const pending = waitForOnsEngine(Promise.resolve(), () => false, () => false);
  const rejected = expect(pending).rejects.toThrow("ONS_RUNTIME_TIMEOUT");
  await vi.advanceTimersByTimeAsync(30_000); await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels while a file is loading and preserves the original failure", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const pending = waitForOnsEngine(new Promise(() => {}), () => false, () => true, controller.signal);
  const error = new Error("network failed"), rejected = expect(pending).rejects.toBe(error);
  controller.abort(error); await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
