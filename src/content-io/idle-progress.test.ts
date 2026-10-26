// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {abortable} from "./abort.js";
import {BlockScheduler} from "./scheduler.js";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {RangeReader} from "./range-reader.js";
import {fetchRangeBlock} from "./http.js";

afterEach(() => vi.useRealTimers());
it("a foreground operation can take 32 seconds while its own bytes keep advancing", async () => {
  vi.useFakeTimers();
  const scheduler = new BlockScheduler<number>();
  const run = vi.fn(async (signal: AbortSignal, progress: (bytes: number) => void) => {
    for (let n = 0; n < 32; n++) {
      await abortable(new Promise(resolve => setTimeout(resolve, 1000)), signal);
      progress(65536);
    }
    return 2 * 1024 * 1024;
  });
  try {
    const result = expect(scheduler.schedule("window", run)).resolves.toBe(2 * 1024 * 1024);
    await vi.advanceTimersByTimeAsync(32_000); await result;
    expect(run).toHaveBeenCalledOnce();
    expect(scheduler.stats.active).toBe(0);
  } finally {scheduler.close();}
});
it("zero-byte progress and another operation cannot renew a stalled foreground operation", async () => {
  vi.useFakeTimers();
  const scheduler = new BlockScheduler<void>();
  const stalled = scheduler.schedule("stalled", async (signal, progress) => {
    for (;;) {await abortable(new Promise(resolve => setTimeout(resolve, 1000)), signal); progress(0);}
  });
  const timedOut = expect(stalled).rejects.toThrow("CONTENT_IO_TIMEOUT");
  const busy = scheduler.schedule("other", async (signal, progress) => {
    for (let n = 0; n < 20; n++) {await abortable(new Promise(resolve => setTimeout(resolve, 1000)), signal); progress(1);}
  });
  try {await vi.advanceTimersByTimeAsync(20_000); await timedOut; await busy;}
  finally {scheduler.close();}
});
it("sub-block response chunks renew the reader before its first 256 KiB block is complete", async () => {
  vi.useFakeTimers();
  const size = 262144, sha = "a".repeat(64);
  const object: BlockObject = {key: "game", state: {generation: "current", pinnedEtag: null, revoked: false},
    source: {identity: {kind: "FILE_SHA256", sha256: sha}, sizeBytes: size, url: "https://example.test/game",
      purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}};
  const fetcher = vi.fn(async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({async pull(controller) {
      if (sent === size) {controller.close(); return;}
      await new Promise(resolve => setTimeout(resolve, 1000)); sent += 8192; controller.enqueue(new Uint8Array(8192).fill(7));
    }});
    const response = new Response(body, {status: 206, headers: {ETag: `"sha256-${sha}"`,
      "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}`}});
    Object.defineProperty(response, "url", {value: object.source.url}); return response;
  });
  const pool = new BlockPool(0, (entry, index, signal, progress) =>
    fetchRangeBlock(entry.source, entry.state, index, signal, 15000, {fetch: fetcher, progress}));
  const reader = new RangeReader("slow", object, pool), bytes = new Uint8Array(1);
  try {
    const success = expect(reader.readInto(0, bytes)).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(33_000); await success;
    expect(bytes[0]).toBe(7); expect(fetcher).toHaveBeenCalledOnce();
  } finally {await reader.close(); pool.close();}
});
