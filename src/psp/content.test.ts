// @vitest-environment node
import {afterEach, describe, expect, it, vi} from "vitest";
import {loadPSPFile, type PSPStore} from "./content.js";
const bytes = new Uint8Array([1, 2, 3]);
const source = {url: "https://retrom.test/content/sha", sizeBytes: 3,
  sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"};
afterEach(() => vi.unstubAllGlobals());
describe("PSP persistent game content", () => {
  it("reuses a Blob across two runtime instances and reports exact download progress", async () => {
    const files = new Map<string, Blob>();
    const store: PSPStore = {get: async key => files.get(key) ?? null, put: async (key, value) => {files.set(key, value);}};
    const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetcher);
    const progress = vi.fn();
    const first = await loadPSPFile(source, progress, store), second = await loadPSPFile(source, progress, store);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toEqual([source.url, expect.not.objectContaining({headers: expect.anything()})]);
    expect(progress).toHaveBeenLastCalledWith({phase: "PROJECT_CONTENT", loadedBytes: 3, totalBytes: 3});
  });
  it("falls back to network when an existing OPFS file cannot be read", async () => {
    const cached = new Blob([bytes]);
    cached.stream = () => new ReadableStream({start(controller) {controller.error(new Error("IO failure"));}});
    const store = {get: async () => cached, put: async () => {}};
    const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetcher);
    expect(new Uint8Array(await (await loadPSPFile(source, vi.fn(), store)).arrayBuffer())).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects truncation, overflow and digest mismatch without caching", async () => {
    const store = {get: async () => null, put: vi.fn()};
    vi.stubGlobal("fetch", async () => new Response(bytes));
    for (const bad of [{...source, sizeBytes: 4}, {...source, sizeBytes: 2}, {...source, sha256: "f".repeat(64)}]) {
      await expect(loadPSPFile(bad, vi.fn(), store)).rejects.toThrow("PPSSPP_CONTENT_INVALID");
    }
    expect(store.put).not.toHaveBeenCalled();
  });
  it("recovers corrupt cache and storage failure; cancellation never returns a game", async () => {
    const store = {get: async () => new Blob([new Uint8Array([0, 0, 0])]), put: async () => {throw new Error("quota");}};
    const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetcher);
    expect((await loadPSPFile(source, vi.fn(), store)).size).toBe(3);
    const abort = new AbortController(); abort.abort();
    await expect(loadPSPFile(source, vi.fn(), store, abort.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
