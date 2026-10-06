// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {fetchRangeInto} from "./http.js";
import {BlockScheduler} from "./scheduler.js";
import {abortable} from "./abort.js";
import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";

const size = 2 * 1024 * 1024, sha = "a".repeat(64);
const source: ContentSourceV1 = {identity: {kind: "FILE_SHA256", sha256: sha}, sizeBytes: size,
  url: "https://example.test/game", purpose: "GAME", transport: "RANGE_REQUIRED",
  etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"};
afterEach(() => vi.useRealTimers());

function streamFetch(chunk: () => Promise<ReadableStreamReadResult<Uint8Array>>) {
  return vi.fn(async () => {
    const body = new ReadableStream<Uint8Array>({async pull(controller) {
      const next = await chunk();
      if (next.done) {controller.close();} else {controller.enqueue(next.value);}
    }});
    const response = new Response(body, {status: 206, headers: {ETag: `"sha256-${sha}"`,
      "Content-Range": `bytes 0-${size - 1}/${size}`, "Content-Length": String(size)}});
    Object.defineProperty(response, "url", {value: source.url});
    return response;
  });
}

it("materializes a 2 MiB Range at 64 KiB/s while retaining the foreground deadline", async () => {
  vi.useFakeTimers();
  let bytes = 0;
  const fetch = streamFetch(async () => {
    if (bytes === size) {return {done: true, value: undefined};}
    await new Promise(resolve => setTimeout(resolve, 1000));
    bytes += 65536;
    return {done: false, value: new Uint8Array(65536).fill(7)};
  });
  const scheduler = new BlockScheduler<Uint8Array>(), controller = new AbortController();
  const run = async (signal: AbortSignal) => {
    const target = new Uint8Array(size);
    await fetchRangeInto(source, {generation: "current", pinnedEtag: null, revoked: false}, 0, target, signal, {fetch});
    return target;
  };
  const materialized = scheduler.schedule("same", run, {priority: "MATERIALIZE", signal: controller.signal});
  // Attach the expectation before advancing timers so a premature rejection is diagnosed.
  const success = expect(materialized.then(data => ({length: data.byteLength, intact: data.every(byte => byte === 7)})))
    .resolves.toEqual({length: size, intact: true});
  const demand = scheduler.schedule("same", run);
  const timeout = expect(demand).rejects.toThrow("CONTENT_IO_TIMEOUT");
  await vi.advanceTimersByTimeAsync(15_000); await timeout;
  await vi.advanceTimersByTimeAsync(18_000); await success;
  expect(fetch).toHaveBeenCalledOnce();
  expect(scheduler.stats.active).toBe(0); scheduler.close();
});

it.each(["stall", "cancel"])("ends a materialization on %s without completing its destination", async (kind) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetch = streamFetch(() => new Promise(() => {}));
  const scheduler = new BlockScheduler<void>();
  const pending = scheduler.schedule("range", active => fetchRangeInto(source,
    {generation: "current", pinnedEtag: null, revoked: false}, 0, new Uint8Array(size), active, {fetch}),
  {priority: "MATERIALIZE", signal: controller.signal});
  const rejected = expect(pending).rejects.toThrow(kind === "cancel" ? "CONTENT_IO_ABORTED" : "CONTENT_IO_TIMEOUT");
  if (kind === "cancel") {controller.abort();} else {await vi.advanceTimersByTimeAsync(15_000);}
  await rejected; scheduler.close();
});

it("cancels queued materialization and releases shared work only after the last waiter leaves", async () => {
  vi.useFakeTimers();
  const scheduler = new BlockScheduler<void>(), controller = new AbortController();
  const run = vi.fn((signal: AbortSignal) => abortable(new Promise<void>(() => {}), signal));
  const pending = Array.from({length: 5}, (_, n) => scheduler.schedule(String(n), run,
    {priority: "MATERIALIZE", signal: controller.signal}).catch((error: Error) => error.message));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(scheduler.stats).toMatchObject({active: 4, queued: 1, waiters: 5});
  controller.abort(); expect(await Promise.all(pending)).toEqual(Array(5).fill("CONTENT_IO_ABORTED"));
  expect(run).toHaveBeenCalledTimes(4); scheduler.close();
});

it("does not treat empty response chunks as download progress", async () => {
  vi.useFakeTimers();
  const fetch = streamFetch(async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {done: false, value: new Uint8Array()};
  });
  const rejected = expect(fetchRangeInto(source, {generation: "current", pinnedEtag: null, revoked: false},
    0, new Uint8Array(size), new AbortController().signal, {fetch})).rejects.toThrow("CONTENT_IO_TIMEOUT");
  await vi.advanceTimersByTimeAsync(15_000); await rejected;
});

it("restores the original physical deadline when the materialization waiter leaves", async () => {
  vi.useFakeTimers();
  const scheduler = new BlockScheduler<void>(), controller = new AbortController();
  const run = (signal: AbortSignal) => abortable(new Promise<void>(() => {}), signal);
  const materialized = scheduler.schedule("shared", run, {priority: "MATERIALIZE", signal: controller.signal});
  const canceled = expect(materialized).rejects.toThrow("CONTENT_IO_ABORTED");
  await vi.advanceTimersByTimeAsync(12_000);
  const demand = scheduler.schedule("shared", run);
  const timedOut = expect(demand).rejects.toThrow("CONTENT_IO_TIMEOUT");
  await vi.advanceTimersByTimeAsync(8000); controller.abort();
  await canceled; await timedOut;
  expect(scheduler.stats.active).toBe(0); scheduler.close();
});
