// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {abortable} from "./abort.js";
import {BlockPool, type BlockObject, type WindowSource} from "./block-pool.js";
import {ContentIOError} from "./errors.js";
import {DEFAULT_FETCH_POLICY} from "./fetch-policy.js";
import {RangeReader} from "./range-reader.js";
import {BLOCK_BYTES as B} from "./source.js";

const pools: BlockPool[] = [];
const tick = async () => {for (let i = 0; i < 40; i++) {await Promise.resolve();}};
const generated: WindowSource["load"] = async (_object, window) =>
  Uint8Array.from({length: window.length}, (_, i) => Math.floor((window.start + i) / B) + 1);
function setup(loadWindow: WindowSource["load"] = generated, size = 10 * B + 17, windowBytes = 2 * B) {
  const object: BlockObject = {key: "game", state: {generation: "one", pinnedEtag: null, revoked: false},
    source: {identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: size, url: "https://example.test/game",
      purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}};
  const load = vi.fn(loadWindow), local = vi.fn(async () => null), failure = vi.fn();
  const pool = new BlockPool(0, undefined, failure, undefined,
    {policy: {...DEFAULT_FETCH_POLICY, networkWindowBytes: windowBytes}, local, load});
  pools.push(pool);
  return {object, pool, load, local, failure, reader: new RangeReader("one", object, pool), other: new RangeReader("two", object, pool)};
}
afterEach(async () => {
  for (const pool of pools.splice(0)) {
    pool.close(); await tick();
    expect(pool.stats).toMatchObject({active: 0, queued: 0, pending: 0, waiters: 0, temporaryBytes: 0});
  }
  vi.useRealTimers();
});
it("prefetch starts at the exact final-block boundary after a memory demand hit, without chaining", async () => {
  const {reader, load} = setup();
  await reader.readInto(2 * B, new Uint8Array(1)); await tick();
  expect(load.mock.calls.map(([, w]) => w.start)).toEqual([2 * B]);
  await reader.readInto(3 * B, new Uint8Array(1)); await tick();
  expect(load.mock.calls.map(([, w]) => [w.start, w.length])).toEqual([[2 * B, 2 * B], [4 * B, 2 * B]]);
  const next = new Uint8Array(9);
  await reader.readInto(4 * B + 7, next); await tick();
  expect(next).toEqual(new Uint8Array(9).fill(5)); expect(load).toHaveBeenCalledTimes(2);
});
it("demand joins an active prefetch and survives the initiating reader closing without a second load", async () => {
  let finish!: () => void;
  const barrier = new Promise<void>(resolve => {finish = resolve;});
  const {reader, other, pool, load, local} = setup(async (object, window, signal) => {
    if (window.start === 2 * B) {await abortable(barrier, signal);}
    return generated(object, window, signal);
  });
  await reader.readInto(B, new Uint8Array(1)); await tick();
  expect(load).toHaveBeenCalledTimes(2);
  const signal = load.mock.calls[1][2], output = new Uint8Array(7), localCalls = local.mock.calls.length;
  const demand = other.readInto(2 * B + 3, output); await tick();
  expect(local).toHaveBeenCalledTimes(localCalls);
  await reader.close(); await tick(); expect(signal.aborted).toBe(false);
  expect(pool.stats.active).toBe(1); finish(); await demand;
  expect(output).toEqual(new Uint8Array(7).fill(3)); expect(load).toHaveBeenCalledTimes(2);
});
it("repeated tail reads do not create extra prefetch waiters or extra physical loads", async () => {
  const {reader, pool, load} = setup(async (object, window, signal) => {
    if (window.start === 2 * B) {await abortable(new Promise<void>(() => {}), signal);}
    return generated(object, window, signal);
  });
  await reader.readInto(B, new Uint8Array(1)); await tick();
  for (let n = 0; n < 20; n++) {await reader.readInto(B + n, new Uint8Array(1));}
  expect(load).toHaveBeenCalledTimes(2); expect(pool.stats.waiters).toBe(1);
  await reader.close(); await tick(); expect(load.mock.calls[1][2].aborted).toBe(true);
});
it("only successful nonempty hot-cache probes trigger prefetch", async () => {
  const {reader, load} = setup();
  expect(reader.tryReadInto(B, new Uint8Array(1))).toBeNull();
  await reader.readInto(0, new Uint8Array(1));
  expect(reader.tryReadInto(B, new Uint8Array())).toBe(0); await tick(); expect(load).toHaveBeenCalledTimes(1);
  expect(reader.tryReadInto(B, new Uint8Array(1))).toBe(1); await tick(); expect(load).toHaveBeenCalledTimes(2);
});
it("small whole files and the final window never prefetch past EOF", async () => {
  for (const size of [B + 17, 4 * B, 4 * B + 17]) {
    const {reader, load} = setup(undefined, size);
    await reader.readInto(size - 1, new Uint8Array(1)); await tick(); expect(load).toHaveBeenCalledTimes(1);
  }
});
it("clips a prefetched EOF window and handles nondefault window sizes", async () => {
  const {reader, load} = setup(undefined, 6 * B + 17, 3 * B);
  await reader.readInto(5 * B, new Uint8Array(1)); await tick();
  expect(load.mock.calls.map(([, w]) => [w.start, w.length])).toEqual([[3 * B, 3 * B], [6 * B, 17]]);
});
it("prefetch network failure does not fail its triggering demand or poison a later retry", async () => {
  let failed = false;
  const {reader, load, failure} = setup(async (object, window, signal) => {
    if (window.start === 2 * B && !failed) {failed = true; throw new ContentIOError("NETWORK_FAILED");}
    return generated(object, window, signal);
  });
  await expect(reader.readInto(B, new Uint8Array(1))).resolves.toBe(1); await tick();
  expect(load).toHaveBeenCalledTimes(2); expect(failure).not.toHaveBeenCalled();
  const bytes = new Uint8Array(1); await reader.readInto(2 * B, bytes); expect(bytes[0]).toBe(3);
});
for (const name of ["IDENTITY_CHANGED", "AUTHORIZATION_FAILED"] as const) {
  it(`prefetch preserves ${name} revocation and notification`, async () => {
    let reject!: (error: Error) => void;
    const barrier = new Promise<void>((_resolve, fail) => {reject = fail;});
    const {reader, other, failure} = setup(async (object, window, signal) => {
      if (window.start === 2 * B) {await barrier;}
      return generated(object, window, signal);
    });
    await reader.readInto(B, new Uint8Array(1)); await tick();
    expect(failure).not.toHaveBeenCalled();
    reject(new ContentIOError(name)); await tick();
    expect(failure).toHaveBeenCalledTimes(1);
    await expect(other.readInto(0, new Uint8Array(1))).rejects.toThrow(name);
  });
}
it("prefetch is skipped under buffer pressure, leaving demand able to read", async () => {
  const {reader, pool, load} = setup();
  await reader.readInto(0, new Uint8Array(1));
  const release = await pool.credits.reserve(6 * 1024 * 1024, "SCRATCH");
  await reader.readInto(B, new Uint8Array(1)); await tick(); expect(load).toHaveBeenCalledTimes(1);
  release(); await reader.readInto(B + 1, new Uint8Array(1)); await tick(); expect(load).toHaveBeenCalledTimes(2);
});
it("first read [300,900) KiB loads two demand windows and only the adjacent [1024,1536) KiB prefetch", async () => {
  const {reader, load} = setup();
  const offset = 300 * 1024, end = 900 * 1024, bytes = new Uint8Array(end - offset);
  await expect(reader.readInto(offset, bytes)).resolves.toBe(600 * 1024); await tick();
  expect(bytes).toEqual(Uint8Array.from({length: end - offset}, (_, n) => Math.floor((offset + n) / B) + 1));
  expect(load.mock.calls.map(([, window]) => [window.start / 1024, (window.start + window.length) / 1024]))
    .toEqual([[0, 512], [512, 1024], [1024, 1536]]);
});
it("a prefetched window already in memory is not reloaded on repeated demand reads", async () => {
  const {reader, pool, load} = setup();
  await reader.readInto(B, new Uint8Array(1)); await tick(); expect(load).toHaveBeenCalledTimes(2);
  for (let n = 0; n < 10; n++) {await reader.readInto(B + n, new Uint8Array(1));}
  await tick(); expect(load).toHaveBeenCalledTimes(2); expect(pool.stats.waiters).toBe(0);
});
it("materialization copies do not initiate prefetch", async () => {
  const {pool, object, load} = setup();
  await pool.copy(object, 1, 0, new Uint8Array(1), () => pool.check(object), {priority: "MATERIALIZE"});
  await tick(); expect(load).toHaveBeenCalledTimes(1);
});
it("session close retains speculative scratch until noncooperative network cleanup and discards late bytes", async () => {
  let finish!: () => void;
  const barrier = new Promise<void>(resolve => {finish = resolve;});
  const {reader, pool} = setup(async (object, window, signal) => {
    if (window.start === 2 * B) {await barrier;}
    return generated(object, window, signal);
  });
  await reader.readInto(B, new Uint8Array(1)); await tick();
  pool.close(); await tick();
  expect(pool.stats).toMatchObject({active: 1, temporaryBytes: 4 * B, lruBytes: 0});
  finish(); await tick(); expect(pool.stats).toMatchObject({active: 0, temporaryBytes: 0, lruBytes: 0});
});
it("a prefetch timeout keeps the existing physical deadline when demand joins", async () => {
  vi.useFakeTimers();
  const {reader, other, pool, load} = setup(async (object, window, signal) => {
    if (window.start === 2 * B) {await abortable(new Promise<void>(() => {}), signal);}
    return generated(object, window, signal);
  });
  await reader.readInto(B, new Uint8Array(1)); await tick();
  await vi.advanceTimersByTimeAsync(14000);
  const pending = other.readInto(2 * B, new Uint8Array(1));
  const rejected = expect(pending).rejects.toThrow("TIMEOUT"); await tick();
  await vi.advanceTimersByTimeAsync(1000); await rejected;
  expect(load).toHaveBeenCalledTimes(2); expect(pool.stats.active).toBe(0);
});
it("demand registered first keeps its foreground [1024,1536) KiB task when prefetch arrives", async () => {
  let finish!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => {finish = resolve;});
  const started = new Promise<void>(resolve => {entered = resolve;});
  const {reader, other, object, pool, load} = setup(async (object, window, signal) => {
    entered(); await abortable(barrier, signal); return generated(object, window, signal);
  });
  pool.cache.put(pool.key(object, 3), new Uint8Array(B).fill(4));
  const bytes = new Uint8Array(17), demand = other.readInto(4 * B + 7, bytes);
  await started;
  expect(pool.scheduler.canPrefetch).toBe(true); expect(pool.stats.waiters).toBe(1);
  await reader.readInto(3 * B, new Uint8Array(1)); await tick();
  expect(load.mock.calls.map(([, w]) => [w.start / 1024, w.length / 1024])).toEqual([[1024, 512]]);
  expect(pool.scheduler.canPrefetch).toBe(true); expect(pool.stats.waiters).toBe(1);
  expect(load.mock.calls[0][2].aborted).toBe(false);
  await reader.close(); finish(); await demand;
  expect(bytes).toEqual(new Uint8Array(17).fill(5)); expect(load).toHaveBeenCalledTimes(1);
});
it("demand paused in local lookup joins the [1024,1536) KiB prefetch registered in the meantime", async () => {
  let resumeLocal!: () => void, localEntered!: () => void, finish!: () => void, loadEntered!: () => void;
  const localBarrier = new Promise<void>(resolve => {resumeLocal = resolve;});
  const localStarted = new Promise<void>(resolve => {localEntered = resolve;});
  const networkBarrier = new Promise<void>(resolve => {finish = resolve;});
  const networkStarted = new Promise<void>(resolve => {loadEntered = resolve;});
  const {reader, other, object, pool, load, local} = setup(async (object, window, signal) => {
    loadEntered(); await abortable(networkBarrier, signal); return generated(object, window, signal);
  });
  pool.cache.put(pool.key(object, 3), new Uint8Array(B).fill(4));
  local.mockImplementationOnce(async () => {localEntered(); await localBarrier; return null;});
  const bytes = new Uint8Array(17), demand = other.readInto(4 * B + 7, bytes);
  await localStarted; expect(pool.stats.pending).toBe(0); expect(load).not.toHaveBeenCalled();
  await reader.readInto(3 * B, new Uint8Array(1)); await networkStarted;
  expect(pool.scheduler.canPrefetch).toBe(false); expect(pool.stats.waiters).toBe(1);
  resumeLocal(); await tick();
  expect(pool.scheduler.canPrefetch).toBe(true); expect(pool.stats.waiters).toBe(2);
  await reader.close(); await tick(); expect(load.mock.calls[0][2].aborted).toBe(false);
  finish(); await demand;
  expect(bytes).toEqual(new Uint8Array(17).fill(5));
  expect(load.mock.calls.map(([, w]) => [w.start / 1024, w.length / 1024])).toEqual([[1024, 512]]);
});
