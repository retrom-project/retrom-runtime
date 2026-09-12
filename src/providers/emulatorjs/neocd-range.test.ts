import {describe, expect, it, vi} from "vitest";
import {createNeoCDRange, neoCDRangeBlockSize as blockSize} from "./neocd-range.js";

const digest = "a".repeat(64), disc = {url: "https://game.test/launch-a", sizeBytes: 400 * 1024 * 1024, sha256: digest};
function setup() {
  const stored = new Map<string, Response>();
  const cache = {match: async (key: string) => stored.get(key)?.clone(),
    put: async (key: string, value: Response) => {stored.set(key, value.clone());},
    delete: async (key: string) => stored.delete(key)};
  const fetcher = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    const range = new Headers(options?.headers).get("Range")!;
    const [start, end] = range.slice(6).split("-").map(Number);
    return new Response(new Uint8Array(end - start + 1).fill(start / blockSize + 1), {status: 206,
      headers: {"Content-Range": `bytes ${start}-${end}/${disc.sizeBytes}`, ETag: `"sha256-${digest}"`}});
  });
  const make = (url = disc.url) => createNeoCDRange({...disc, url}, new AbortController().signal, vi.fn(), {cache: async () => cache, fetcher});
  return {stored, cache, fetcher, make};
}
describe("NeoCD bounded Range disc", () => {
  it("starts without a full download and reuses verified blocks across Launch URLs", async () => {
    const fixture = setup(), first = fixture.make();
    expect(fixture.fetcher).not.toHaveBeenCalled();
    expect(await first.read(10, 8)).toEqual(new Uint8Array(8).fill(1));
    expect(await first.read(blockSize - 2, 4)).toEqual(new Uint8Array([1, 1, 2, 2]));
    expect(first.read(10, 8)).toBeInstanceOf(Uint8Array);
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
    await first.dispose();
    const second = fixture.make("https://game.test/launch-b");
    expect(await second.read(10, 8)).toEqual(new Uint8Array(8).fill(1));
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
    await second.dispose();
  });
  it("rejects servers ignoring Range without consuming the full body", async () => {
    const cancel = vi.fn(), fetcher = vi.fn(async () => new Response(new ReadableStream({cancel}), {status: 200}));
    const reader = createNeoCDRange(disc, new AbortController().signal, vi.fn(), {cache: async () => null, fetcher});
    await expect(reader.read(0, 16)).rejects.toThrow("NEOCD_RANGE_INVALID");
    expect(cancel).toHaveBeenCalled(); await reader.dispose();
  });
  it("rejects mismatched identity, range, short and oversized payloads", async () => {
    for (const change of [{etag: '"other"'}, {range: `bytes 1-${blockSize}/${disc.sizeBytes}`}, {length: 5}, {length: blockSize + 1}]) {
      const fetcher = vi.fn(async () => new Response(new Uint8Array(change.length ?? blockSize), {status: 206, headers: {
        ETag: change.etag ?? `"sha256-${digest}"`, "Content-Range": change.range ?? `bytes 0-${blockSize - 1}/${disc.sizeBytes}`}}));
      const reader = createNeoCDRange(disc, new AbortController().signal, vi.fn(), {cache: async () => null, fetcher});
      await expect(reader.read(0, 10)).rejects.toThrow("NEOCD_RANGE_INVALID"); await reader.dispose();
    }
  });
  it("detects same-size cache corruption and refetches only that block", async () => {
    const fixture = setup(), first = fixture.make(); await first.read(0, 4); await first.dispose();
    const [key, value] = [...fixture.stored][0];
    fixture.stored.set(key, new Response(new Uint8Array(blockSize).fill(9), {headers: value.headers}));
    const second = fixture.make(); expect(await second.read(0, 4)).toEqual(new Uint8Array(4).fill(1));
    expect(fixture.fetcher).toHaveBeenCalledTimes(2); await second.dispose();
  });
  it("continues bounded network reads when persistent storage fails", async () => {
    const fixture = setup(); fixture.cache.put = async () => {throw new Error("quota");};
    const first = fixture.make(); await first.read(0, 4); await first.dispose();
    const second = fixture.make(); await second.read(0, 4); expect(fixture.fetcher).toHaveBeenCalledTimes(2); await second.dispose();
  });
  it("bounds memory, deduplicates overlapping reads and aborts on disposal", async () => {
    const fixture = setup(), reader = fixture.make();
    await Promise.all([reader.read(0, 8), reader.read(4, 8)]); expect(fixture.fetcher).toHaveBeenCalledTimes(1);
    for (let i = 1; i < 70; ++i) {await reader.read(i * blockSize, 4);}
    expect(reader.memoryBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(() => reader.read(0, blockSize + 1)).toThrow("NEOCD_RANGE_READ_INVALID");
    await reader.dispose(); expect(() => reader.read(0, 4)).toThrow();
  });
  it("aborts an in-flight network block and settles native idle before disposal", async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => {started = resolve;});
    const fetcher: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("aborted")), {once: true}); started();
    });
    const reader = createNeoCDRange(disc, new AbortController().signal, vi.fn(), {cache: async () => null, fetcher});
    reader.begin();
    const reading = Promise.resolve(reader.read(0, 8)).finally(() => reader.end());
    const rejected = expect(reading).rejects.toThrow("aborted");
    await ready; await reader.dispose(); await rejected;
    expect(reader.memoryBytes).toBe(0);
  });
  it("reads the exact short final block and rejects reads past EOF", async () => {
    const small = {...disc, sizeBytes: blockSize + 3};
    const fetcher = vi.fn(async () => new Response(new Uint8Array([4, 5, 6]), {status: 206, headers: {
      ETag: `"sha256-${digest}"`, "Content-Range": `bytes ${blockSize}-${blockSize + 2}/${small.sizeBytes}`}}));
    const reader = createNeoCDRange(small, new AbortController().signal, vi.fn(), {cache: async () => null, fetcher});
    expect(await reader.read(blockSize + 1, 2)).toEqual(new Uint8Array([5, 6]));
    expect(() => reader.read(blockSize + 2, 2)).toThrow("NEOCD_RANGE_READ_INVALID");
    await reader.dispose();
  });

  it("calls browser fetch without an options-object receiver", async () => {
    const fixture = setup();
    const fetcher: typeof fetch = async function(this: unknown, ...args) {
      expect(this).toBeUndefined(); return fixture.fetcher(...args);
    };
    const reader = createNeoCDRange(disc, new AbortController().signal, vi.fn(), {cache: async () => null, fetcher});
    await reader.read(0, 8); await reader.dispose();
  });

});
