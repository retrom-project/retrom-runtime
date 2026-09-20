// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {abortable} from "./abort.js";
import {BlockScheduler} from "./scheduler.js";
const tick = async () => {for (let i = 0; i < 10; i++) {await Promise.resolve();}};
afterEach(() => vi.useRealTimers());
it("[IO-06] UNIT/reader [IO-08] UNIT/reader shares physical work without sharing cancellation", async () => {
  const scheduler = new BlockScheduler<number>(), cancelled = new AbortController();
  let release!: (value: number) => void;
  const operation = vi.fn((signal: AbortSignal) => abortable(new Promise<number>((resolve) => {release = resolve;}), signal));
  const reads = Array.from({length: 20}, (_, index) => scheduler.schedule("same", operation, index === 0 ? {signal: cancelled.signal} : {}));
  const first = expect(reads[0]).rejects.toThrow("CONTENT_IO_ABORTED"); cancelled.abort(); await first;
  expect(operation).toHaveBeenCalledTimes(1); expect(operation.mock.calls[0][0].aborted).toBe(false);
  release(7); expect(await Promise.all(reads.slice(1))).toEqual(Array(19).fill(7));
  expect(scheduler.stats).toEqual({active: 0, queued: 0, pending: 0, waiters: 0}); scheduler.close();
});
it("[IO-09] UNIT/reader [IO-23] UNIT/reader bounds distinct queued work and removes cancelled tasks", async () => {
  const scheduler = new BlockScheduler<void>(), controller = new AbortController(), aborts = vi.fn();
  const run = vi.fn((signal: AbortSignal) => {signal.addEventListener("abort", aborts, {once: true}); return abortable(new Promise<void>(() => {}), signal);});
  const reads = Array.from({length: 260}, (_, index) => scheduler.schedule(String(index), run, {signal: controller.signal}).catch((error: Error) => error.message));
  expect(scheduler.stats).toEqual({active: 4, queued: 256, pending: 260, waiters: 260});
  expect(() => scheduler.schedule("overflow", run)).toThrow("CAPACITY_EXCEEDED");
  controller.abort(); expect(await Promise.all(reads)).toEqual(Array(260).fill("CONTENT_IO_ABORTED")); await tick();
  expect(aborts).toHaveBeenCalledTimes(4); expect(run).toHaveBeenCalledTimes(4);
  expect(scheduler.stats).toEqual({active: 0, queued: 0, pending: 0, waiters: 0}); scheduler.close();
});
it("[X-05] UNIT/reader gives background work a slot after at most eight foreground dispatches", async () => {
  const scheduler = new BlockScheduler<void>();
  const order: string[] = [], releases: (() => void)[] = [];
  const run = (name: string) => async () => {order.push(name); await new Promise<void>((resolve) => releases.push(resolve));};
  const reads = Array.from({length: 20}, (_, index) => scheduler.schedule(`f${index}`, run(`f${index}`)));
  reads.push(scheduler.schedule("background", run("background"), {priority: "MATERIALIZE"}));
  while (releases.length) {releases.shift()!(); await tick();}
  await Promise.all(reads); expect(order.indexOf("background")).toBeLessThanOrEqual(8);
  expect(scheduler.stats.active).toBe(0); scheduler.close();
});
it("[IO-24] UNIT/reader later waiters cannot extend a physical deadline and late bytes are disposed", async () => {
  vi.useFakeTimers();
  const disposed = vi.fn(), scheduler = new BlockScheduler<number>(disposed);
  let release!: (n: number) => void;
  const run = () => new Promise<number>((resolve) => {release = resolve;});
  const first = scheduler.schedule("slow", run).catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(14000);
  const second = scheduler.schedule("slow", run).catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await first).toBe("CONTENT_IO_TIMEOUT"); expect(await second).toBe("CONTENT_IO_TIMEOUT");
  expect(scheduler.stats.waiters).toBe(0);
  // Non-cooperative work still occupies its physical slot until it actually finishes.
  expect(scheduler.stats.active).toBe(1); release(17); await tick();
  expect(disposed).toHaveBeenCalledWith(17); expect(scheduler.stats.active).toBe(0); scheduler.close();
});
it("whole streams share four network slots but only one whole task can run", async () => {
  const scheduler = new BlockScheduler<void>(), releases: (() => void)[] = [], started: string[] = [];
  const run = (name: string) => async () => {started.push(name); await new Promise<void>((resolve) => releases.push(resolve));};
  const tasks = [scheduler.schedule("a", run("a"), {whole: true}), scheduler.schedule("b", run("b"), {whole: true}), scheduler.schedule("c", run("c"))];
  expect(started).toEqual(["a", "c"]); releases.shift()!(); await tick(); expect(started).toEqual(["a", "c", "b"]);
  for (const release of releases) {release();} await Promise.all(tasks); scheduler.close();
});
