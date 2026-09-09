import {createHash, webcrypto} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {fetchSwf} from "./fetch.js";

const bytes = new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0]);
const source = {swfUrl: "https://content.test/game.swf", swfSizeBytes: bytes.length,
  contentDigest: createHash("sha256").update(bytes).digest("hex")};
afterEach(() => vi.unstubAllGlobals());
describe("Ruffle immutable content", () => {
  it("uses a validated persistent response for a second runtime instance", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const network = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", network);
    const stored = new Map<string, Response>();
    const cache = {match: vi.fn(async (url: string) => stored.get(url)?.clone()),
      put: vi.fn(async (url: string, response: Response) => {stored.set(url, response.clone());})};
    const caches = {open: async () => cache} as unknown as CacheStorage;
    const progress = vi.fn();
    expect(await fetchSwf(source, progress, caches)).toEqual(bytes);
    expect(await fetchSwf({...source, swfUrl: "https://content.test/another-launch/game.swf"}, progress, caches)).toEqual(bytes);
    expect(network).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith({phase: "PROJECT_CONTENT", loadedBytes: 8, totalBytes: 8});
  });
  it("rejects truncation and excess bytes even when response headers are missing", async () => {
    vi.stubGlobal("crypto", webcrypto);
    for (const data of [bytes.slice(0, 5), new Uint8Array(9)]) {
      vi.stubGlobal("fetch", async () => new Response(data));
      await expect(fetchSwf(source, () => undefined)).rejects.toThrow("RUFFLE_CONTENT_INVALID");
    }
  });
  it("rejects invalid signatures and excessive declared decompressed sizes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    for (const data of [new Uint8Array(8), new Uint8Array([67, 87, 83, 9, 255, 255, 255, 255])]) {
      vi.stubGlobal("fetch", async () => new Response(data));
      await expect(fetchSwf({...source, contentDigest: createHash("sha256").update(data).digest("hex")}, () => undefined))
        .rejects.toThrow("RUFFLE_CONTENT_INVALID");
    }
  });
  it("falls back to the network when persistent storage is unavailable", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("fetch", async () => new Response(bytes));
    const caches = {open: async () => {throw new Error("quota");}} as unknown as CacheStorage;
    expect(await fetchSwf(source, () => undefined, caches)).toEqual(bytes);
  });
});
