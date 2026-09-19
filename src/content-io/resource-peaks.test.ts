import {expect, it} from "vitest";
import {BufferCredits} from "./credits.js";
import {ByteLRU} from "./lru.js";
import {BlockScheduler} from "./scheduler.js";

it("[IO-23] UNIT/resource-peaks retains temporary and output peaks after every claim has released", async () => {
  const credits = new BufferCredits(16, 8, 2);
  const scratch = await credits.reserve(5, "SCRATCH"), output = await credits.reserve(8, "OUTPUT");
  const write = await credits.reserve(2, "CACHE_WRITE");
  scratch(); output(); write(); write();
  expect(credits.stats).toEqual({temporaryBytes: 0, outputBytes: 0, cacheWriteBytes: 0, waiting: 0});
  expect(credits.peaks).toEqual({temporaryBytes: 15, outputBytes: 8, cacheWriteBytes: 2});
});
it("[IO-23] UNIT/resource-peaks counts retained LRU bytes exactly across replacement, eviction, resize and clear", () => {
  const cache = new ByteLRU(7);
  cache.put("first", new Uint8Array(4)); cache.put("tail", new Uint8Array(2));
  cache.put("first", new Uint8Array(3)); cache.delete("tail"); cache.clear(); cache.resize(2);
  cache.put("overflow", new Uint8Array(3));
  expect(cache.byteLength).toBe(0); expect(cache.peakByteLength).toBe(6);
});
it("[IO-23] UNIT/resource-peaks captures queue and waiters before all physical operations finish", async () => {
  const scheduler = new BlockScheduler<number>();
  let finish!: () => void;
  const barrier = new Promise<void>(resolve => {finish = resolve;});
  const reads = Array.from({length: 9}, (_, index) => scheduler.schedule(String(index % 8), async () => {await barrier; return index;}));
  expect(scheduler.stats).toEqual({active: 4, queued: 4, pending: 8, waiters: 9});
  finish(); await Promise.all(reads);
  expect(scheduler.stats).toEqual({active: 0, queued: 0, pending: 0, waiters: 0});
  expect(scheduler.peaks).toEqual({active: 4, queued: 4, pending: 8, waiters: 9});
});
