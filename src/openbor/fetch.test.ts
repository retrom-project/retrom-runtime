import {createHash, webcrypto} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {chunkSize, fetchPak} from "./fetch.js";
class MemoryCache {
  readonly entries = new Map<string, Response>();
  async match(key: string) {return this.entries.get(key)?.clone();}
  async put(key: string, response: Response) {this.entries.set(key, response.clone());}
}
function fixture() {
  const data = new Uint8Array(chunkSize + 19); data.set([80, 65, 67, 75]);
  const source = {url: "https://retrom.test/content/game", sizeBytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex")};
  const cache = new MemoryCache();
  const storage = {open: async () => cache} as unknown as CacheStorage;
  vi.stubGlobal("crypto", webcrypto);
  const network = vi.fn(async () => new Response(data)); vi.stubGlobal("fetch", network);
  return {data, source, cache, storage, network};
}
afterEach(() => vi.unstubAllGlobals());
describe("OpenBOR immutable PAK cache", () => {
  it("reuses bounded chunks across two runtime instances with exact aggregate progress", async () => {
    const {source, storage, network, cache, data} = fixture();
    const progress = vi.fn();
    expect(Buffer.from(await fetchPak(source, progress, storage)).equals(Buffer.from(data))).toBe(true);
    expect(Buffer.from(await fetchPak(source, progress, storage)).equals(Buffer.from(data))).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
    expect(cache.entries.size).toBe(2);
    for (const response of cache.entries.values()) {expect((await response.clone().arrayBuffer()).byteLength).toBeLessThanOrEqual(chunkSize);}
    expect(progress).toHaveBeenLastCalledWith({phase: "PROJECT_CONTENT", loadedBytes: data.length, totalBytes: data.length});
  });
  it("refetches corrupt cache bytes and remains playable when persistence fails", async () => {
    const {source, storage, network, cache, data} = fixture();
    await fetchPak(source, () => undefined, storage);
    cache.entries.set(`${source.url}?openborChunk=0`, new Response(Uint8Array.of(0)));
    expect(Buffer.from(await fetchPak(source, () => undefined, storage)).equals(Buffer.from(data))).toBe(true);
    expect(network).toHaveBeenCalledTimes(2);
    const failed = {open: async () => {throw new Error("quota");}} as unknown as CacheStorage;
    expect(Buffer.from(await fetchPak(source, () => undefined, failed)).equals(Buffer.from(data))).toBe(true);
  });
  it("rejects size drift and cancellation without publishing partial content", async () => {
    const {source, storage, network, cache} = fixture();
    network.mockImplementation(async () => new Response(Uint8Array.of(80, 65, 67, 75)));
    await expect(fetchPak(source, () => undefined, storage)).rejects.toThrow("OPENBOR_CONTENT_INVALID");
    expect(cache.entries.size).toBe(0);
    const controller = new AbortController(); controller.abort();
    await expect(fetchPak(source, () => undefined, storage, controller.signal)).rejects.toThrow();
  });
});
