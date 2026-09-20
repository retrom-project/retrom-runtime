// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {ContentMaterializer} from "./materializer.js";
import {ContentStoreManager} from "./store/manager.js";
import {WindowLoader} from "./window-loader.js";
import {DEFAULT_FETCH_POLICY} from "./fetch-policy.js";
import {BLOCK_BYTES} from "./source.js";

afterEach(() => vi.unstubAllGlobals());
function setup(sizeBytes: number) {
  const object: BlockObject = {key: "test", source: {url: "https://example.test/object", sizeBytes,
    purpose: "GAME", identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "data"},
    transport: "WHOLE_ALLOWED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"},
  state: {generation: "one", pinnedEtag: null, revoked: false}};
  const pool = new BlockPool(), store = new ContentStoreManager("https://example.test", pool.credits);
  const loader = new WindowLoader(store, pool.cache, (entry, index) => pool.key(entry, index));
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("Range"), [start, end] = range ? range.slice(6).split("-").map(Number) : [0, sizeBytes - 1];
    const headers = new Headers({ETag: '"pinned"', "Content-Length": String(end - start + 1)});
    if (range) {headers.set("Content-Range", `bytes ${start}-${end}/${sizeBytes}`);}
    const response = new Response(new Uint8Array(end - start + 1).fill(19), {status: range ? 206 : 200, headers});
    Object.defineProperty(response, "url", {value: object.source.url}); return response;
  }));
  return {object, pool, store, loader};
}
it("[IO-24] UNIT/transport-metrics aggregates legacy block, window and materializer dispatches once", async () => {
  const {object, pool, store, loader} = setup(5 * BLOCK_BYTES);
  try {
    await store.prepare(object);
    expect((await store.read(object, 0, new AbortController().signal))[0]).toBe(19);
    await loader.load(object, {start: BLOCK_BYTES * 2, length: BLOCK_BYTES * 2, firstBlock: 2, blockCount: 2, wholeFile: false}, new AbortController().signal);
    const result = await new ContentMaterializer(pool, store).prepare(object, {kind: "BYTES", maxBytes: object.source.sizeBytes});
    expect(result.kind).toBe("BYTES");
    expect(store.stats).toMatchObject({networkBytes: 8 * BLOCK_BYTES, rangeRequests: 2, wholeRequests: 1, headRequests: 0, retries: 0});
  } finally {pool.close(); store.close();}
});
it("[IO-17] UNIT/transport-metrics counts a threshold whole load once and cache reuse as no dispatch", async () => {
  const {object, pool, store, loader} = setup(DEFAULT_FETCH_POLICY.smallFileThresholdBytes);
  const window = {start: 0, length: object.source.sizeBytes, firstBlock: 0, blockCount: 4, wholeFile: true};
  try {
    await store.prepare(object);
    const bytes = await loader.load(object, window, new AbortController().signal);
    for (let index = 0; index < 4; index++) {pool.cache.put(pool.key(object, index), bytes.subarray(index * BLOCK_BYTES, (index + 1) * BLOCK_BYTES));}
    await loader.load(object, window, new AbortController().signal);
    expect(store.stats).toMatchObject({networkBytes: 4 * BLOCK_BYTES, rangeRequests: 0, wholeRequests: 1, headRequests: 0, retries: 0});
    expect(fetch).toHaveBeenCalledOnce();
  } finally {pool.close(); store.close();}
});
