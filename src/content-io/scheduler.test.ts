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
it("foreground and materialization dispatch before queued prefetch, with at most one active prefetch", async () => {
  const scheduler = new BlockScheduler<void>(), releases: (() => void)[] = [], order: string[] = [];
  const run = (name: string) => async () => {order.push(name); await new Promise<void>(resolve => releases.push(resolve));};
  const reads = Array.from({length: 4}, (_, n) => scheduler.schedule(`busy${n}`, run(`busy${n}`)));
  reads.push(scheduler.schedule("prefetch-a", run("prefetch-a"), {priority: "PREFETCH"}));
  reads.push(scheduler.schedule("prefetch-b", run("prefetch-b"), {priority: "PREFETCH"}));
  reads.push(scheduler.schedule("materialize", run("materialize"), {priority: "MATERIALIZE"}));
  reads.push(scheduler.schedule("demand", run("demand")));
  expect(scheduler.canPrefetch).toBe(false);
  for (let n = 0; n < 4; n++) {releases.shift()!(); await tick();}
  expect(order.slice(4)).toEqual(["demand", "materialize", "prefetch-a"]);
  expect(scheduler.stats.active).toBe(3); expect(scheduler.canPrefetch).toBe(false);
  while (releases.length) {releases.shift()!(); await tick();}
  await Promise.all(reads); expect(order.at(-1)).toBe("prefetch-b"); expect(scheduler.canPrefetch).toBe(true);
});
it("default foreground joins and promotes a queued prefetch without replacing its operation", async () => {
  const scheduler = new BlockScheduler<number>(), releases: (() => void)[] = [], order: string[] = [];
  const run = (name: string) => async () => {order.push(name); await new Promise<void>(resolve => releases.push(resolve)); return 7;};
  const reads = Array.from({length: 4}, (_, n) => scheduler.schedule(`busy${n}`, run(`busy${n}`)));
  const original = vi.fn(run("prefetch")), replacement = vi.fn(run("duplicate"));
  reads.push(scheduler.schedule("same", original, {priority: "PREFETCH"}));
  reads.push(scheduler.schedule("materialize", run("materialize"), {priority: "MATERIALIZE"}));
  reads.push(scheduler.schedule("same", replacement));
  releases.shift()!(); await tick(); expect(order.at(-1)).toBe("prefetch");
  while (releases.length) {releases.shift()!(); await tick();}
  await expect(Promise.all(reads)).resolves.toEqual(Array(7).fill(7));
  expect(original).toHaveBeenCalledTimes(1); expect(replacement).not.toHaveBeenCalled();
});
it("promotion of active prefetch releases the speculative limit without aborting the physical task", async () => {
  const scheduler = new BlockScheduler<number>(); let finish!: (value: number) => void;
  let signal!: AbortSignal;
  const prefetched = scheduler.schedule("same", active => {signal = active; return new Promise(resolve => {finish = resolve;});}, {priority: "PREFETCH"});
  expect(scheduler.canPrefetch).toBe(false);
  const duplicate = vi.fn(async () => 99), demand = scheduler.schedule("same", duplicate);
  expect(scheduler.canPrefetch).toBe(true); expect(signal.aborted).toBe(false);
  finish(7); expect(await Promise.all([prefetched, demand])).toEqual([7, 7]); expect(duplicate).not.toHaveBeenCalled();
});
it("cancelled noncooperative prefetch retains its slot and speculative limit until cleanup finishes", async () => {
  const scheduler = new BlockScheduler<number>(), controller = new AbortController(); let finish!: (n: number) => void;
  const pending = scheduler.schedule("same", () => new Promise<number>(resolve => {finish = resolve;}), {priority: "PREFETCH", signal: controller.signal});
  const rejected = expect(pending).rejects.toThrow("ABORTED"); controller.abort(); await rejected;
  expect(scheduler.stats.active).toBe(1); expect(scheduler.canPrefetch).toBe(false);
  finish(7); await tick(); expect(scheduler.canPrefetch).toBe(true); expect(scheduler.stats.active).toBe(0);
});
