// @vitest-environment node
import {afterEach, describe, expect, it, vi} from "vitest";
import {BlockPool, type BlockObject} from "../../content-io/block-pool.js";
import {RangeReader} from "../../content-io/range-reader.js";
import {fetchRangeBlock} from "../../content-io/http.js";
import {createNeoCDRange, neoCDRangeBlockSize as B} from "./neocd-range.js";
const disc = {sizeBytes: 400 * 1024 * 1024, sha256: "a".repeat(64)};
const pools: BlockPool[] = [];
function setup(sizeBytes = disc.sizeBytes) {
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const [start, end] = new Headers(options?.headers).get("Range")!.slice(6).split("-").map(Number);
    return new Response(new Uint8Array(end - start + 1).fill(start / B + 1), {status: 206, headers: {
      "Content-Range": `bytes ${start}-${end}/${sizeBytes}`, ETag: `"sha256-${disc.sha256}"`}});
  });
  const object: BlockObject = {key: "disc", state: {generation: "generation", pinnedEtag: null, revoked: false},
    source: {identity: {kind: "FILE_SHA256", sha256: disc.sha256}, sizeBytes, url: "https://game.test/launch",
      purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", }};
  const pool = new BlockPool(0, (object, index, signal) => fetchRangeBlock(object.source, object.state, index, signal, 15000, {fetch: async (...args) => {const response = await fetcher(...args); Object.defineProperty(response, "url", {value: "https://game.test/launch"}); return response;}}));
  pools.push(pool);
  const make = () => createNeoCDRange({...disc, sizeBytes}, new RangeReader(crypto.randomUUID(), object, pool), vi.fn());
  return {fetcher, pool, make};
}
afterEach(() => {for (const pool of pools.splice(0)) {pool.close();}});
describe("NeoCD public Reader facade", () => {
  it("[BR-01] UNIT/neocd [IO-06] UNIT/neocd preserves synchronous hits, asynchronous misses and shared handles", async () => {
    const {fetcher, make} = setup(), first = make(); expect(fetcher).not.toHaveBeenCalled();
    const cold = first.read(10, 8); expect(cold).toBeInstanceOf(Promise); expect(await cold).toEqual(new Uint8Array(8).fill(1));
    const partial = first.read(B - 2, 4); expect(partial).toBeInstanceOf(Promise); expect(await partial).toEqual(new Uint8Array([1, 1, 2, 2]));
    const hit = first.read(10, 8); expect(hit).toBeInstanceOf(Uint8Array); expect(fetcher).toHaveBeenCalledTimes(2);
    const second = make(); await first.dispose(); expect(second.read(10, 8)).toBeInstanceOf(Uint8Array);
    expect(fetcher).toHaveBeenCalledTimes(2); await second.dispose();
  });
  it("[IO-22] UNIT/neocd [ST-16] UNIT/neocd-raw-isolation outputs can be mutated or detached without poisoning public cache", async () => {
    const {make, fetcher} = setup(), reader = make(), sibling = make(), bytes = await reader.read(0, 8);
    bytes.fill(99); structuredClone(bytes, {transfer: [bytes.buffer]});
    expect(reader.read(0, 8)).toEqual(new Uint8Array(8).fill(1)); expect(fetcher).toHaveBeenCalledTimes(1);
    await reader.dispose(); expect(() => reader.read(0, 8)).toThrow("ABORTED");
    expect(sibling.read(0, 8)).toEqual(new Uint8Array(8).fill(1)); expect(fetcher).toHaveBeenCalledTimes(1); await sibling.dispose();
  });
  it("[IO-14] UNIT/neocd rejects ignored Range without consuming a full body", async () => {
    const {fetcher, make} = setup(), cancel = vi.fn();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({cancel}), {status: 200}));
    const reader = make(); await expect(reader.read(0, 8)).rejects.toThrow("RANGE_UNSUPPORTED");
    expect(cancel).toHaveBeenCalled(); await reader.dispose();
  });
  it("[IO-15] UNIT/neocd propagates shared identity/range/length errors", async () => {
    for (const change of [{etag: '"other"', code: "IDENTITY_CHANGED"}, {range: `bytes 1-${B}/${disc.sizeBytes}`, code: "RANGE_INVALID"},
      {length: 5, code: "LENGTH_MISMATCH"}, {length: B + 1, code: "LENGTH_MISMATCH"}]) {
      const {fetcher, make} = setup();
      fetcher.mockImplementation(async () => new Response(new Uint8Array(change.length ?? B), {status: 206, headers: {
        ETag: change.etag ?? `"sha256-${disc.sha256}"`, "Content-Range": change.range ?? `bytes 0-${B - 1}/${disc.sizeBytes}`}}));
      const reader = make(); await expect(reader.read(0, 8)).rejects.toThrow(change.code); await reader.dispose();
    }
  });
  it("[IO-08] UNIT/neocd deduplicates overlap while native idle remains an independent barrier", async () => {
    const {make, fetcher, pool} = setup(), reader = make();
    reader.begin(); let idle = false; const barrier = reader.idle().then(() => {idle = true;});
    await Promise.all([reader.read(0, 8), reader.read(4, 8)]); expect(fetcher).toHaveBeenCalledTimes(1); expect(idle).toBe(false);
    reader.end(); await barrier; expect(idle).toBe(true); expect(() => reader.end()).toThrow("INTERNAL");
    for (let index = 1; index < 70; index++) {await reader.read(index * B, 4);}
    expect(pool.stats.lruBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(() => reader.read(0, B + 1)).toThrow("BOUNDS"); await reader.dispose();
  });
  it("keeps state capture behind a quiet period after native Content I/O", async () => {
    const {make} = setup(), reader = make();
    expect(reader.quietFor(1000)).toBe(false);
    reader.begin();
    await reader.read(0, 8);
    reader.end();
    expect(reader.quietFor(1000)).toBe(false);
    expect(reader.quietFor(0)).toBe(true);
    reader.begin();
    expect(reader.read(0, 8)).toBeInstanceOf(Uint8Array);
    expect(reader.quietFor(0)).toBe(true);
    reader.end();
    await reader.dispose();
    expect(reader.quietFor(0)).toBe(false);
  });
  it("[BR-08] UNIT/neocd [BR-09] UNIT/neocd disposal cancels pending I/O then waits for native finally/end", async () => {
    const {fetcher, make} = setup(); let started!: () => void; const ready = new Promise<void>(resolve => {started = resolve;});
    fetcher.mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true}); started();
    }));
    const reader = make(); reader.begin();
    const reading = Promise.resolve(reader.read(0, 8)).finally(() => reader.end());
    const rejected = expect(reading).rejects.toThrow("ABORTED"); await ready;
    const closing = reader.dispose(); expect(reader.dispose()).toBe(closing); await closing; await rejected;
  });
  it("reads the exact short final block and rejects reads past EOF", async () => {
    const {make} = setup(B + 3), reader = make();
    expect(await reader.read(B + 1, 2)).toEqual(new Uint8Array([2, 2]));
    expect(() => reader.read(B + 2, 2)).toThrow("BOUNDS"); await reader.dispose();
  });
  it("[X-30] UNIT/neocd-existing-read-limit preserves the existing native facade bound before acquisition", async () => {
    const {make, fetcher} = setup(), reader = make();
    expect(() => reader.read(0, 17 * 1024 * 1024)).toThrow("BOUNDS");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await reader.read(0, B)).length).toBe(B); await reader.dispose();
  });
});
