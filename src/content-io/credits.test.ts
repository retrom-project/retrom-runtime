import {expect, it} from "vitest";
import {BufferCredits} from "./credits.js";
it("[IO-23] UNIT/reader enforces output as a subset of scratch and cancels waiting reservations", async () => {
  const credits = new BufferCredits(8, 4), controller = new AbortController();
  const output = await credits.reserve(4, "OUTPUT"), scratch = await credits.reserve(4, "SCRATCH");
  const waiting = credits.reserve(1, "OUTPUT", controller.signal);
  const result = expect(waiting).rejects.toThrow("ABORTED"); controller.abort(); await result;
  expect(credits.stats).toEqual({temporaryBytes: 8, outputBytes: 4, cacheWriteBytes: 0, waiting: 0});
  expect(() => credits.reserve(5, "OUTPUT")).toThrow("CAPACITY_EXCEEDED");
  output(); output(); scratch(); expect(credits.stats).toEqual({temporaryBytes: 0, outputBytes: 0, cacheWriteBytes: 0, waiting: 0});
});

it("[IO-23] UNIT/cache-write-budget retains abandoned write credits independently of network windows", async () => {
  const credits = new BufferCredits(8, 4, 1);
  const output = await credits.reserve(4, "OUTPUT"), scratch = await credits.reserve(3, "SCRATCH");
  const write = await credits.reserve(1, "CACHE_WRITE");
  expect(credits.stats).toMatchObject({temporaryBytes: 8, cacheWriteBytes: 1});
  scratch(); output();
  expect(credits.stats).toMatchObject({temporaryBytes: 1, cacheWriteBytes: 1});
  const next = await credits.reserve(7, "SCRATCH");
  expect(credits.stats.temporaryBytes).toBe(8);
  expect(() => credits.reserve(8, "SCRATCH")).toThrow("CAPACITY_EXCEEDED");
  next(); write(); expect(credits.stats.temporaryBytes).toBe(0);
});
