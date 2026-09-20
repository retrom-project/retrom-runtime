import {expect, it} from "vitest";
import {ByteLRU} from "./lru.js";
it("[IO-22] UNIT/reader owns its buffers and accounts replacement, tail length and pins", () => {
  const cache = new ByteLRU(6), input = new Uint8Array([1, 2, 3]);
  cache.put("a", input); input[0] = 99;
  expect(cache.get("a")).toEqual(new Uint8Array([1, 2, 3]));
  const hit = cache.get("a")!; hit[0] = 77;
  expect(cache.get("a")![0]).toBe(1);
  const release = cache.pin("a")!;
  cache.put("b", new Uint8Array(3)); cache.put("c", new Uint8Array(2));
  expect(cache.has("a")).toBe(true); expect(cache.has("b")).toBe(false); expect(cache.byteLength).toBe(5);
  release(); release(); cache.put("c", new Uint8Array(1)); expect(cache.byteLength).toBe(4);
  cache.clear(); expect(cache.byteLength).toBe(0);
});
