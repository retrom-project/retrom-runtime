import {afterEach, describe, expect, it, vi} from "vitest";
import {loadDisk, type DiskStore} from "./content.js";
const bytes = new Uint8Array([1, 2, 3]);
const digest = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
afterEach(() => vi.unstubAllGlobals());
describe("PC-98 immutable disk materialization", () => {
  it("reuses disk bytes across instances and reports bounded progress", async () => {
    const files = new Map<string, Uint8Array>();
    const store: DiskStore = {get: async key => files.get(key) ?? null, put: async (key, value) => {files.set(key, value.slice());}};
    const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetcher);
    const progress = vi.fn(), config = {url: "https://retrom.test/content/sha", sha256: digest, sizeBytes: bytes.length};
    expect(await loadDisk(config, progress, store)).toEqual(bytes);
    expect(await loadDisk(config, progress, store)).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith({phase: "PROJECT_CONTENT", loadedBytes: 3, totalBytes: 3});
  });
  it("rejects truncated network bytes and falls back from corrupt or unavailable storage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    const store: DiskStore = {get: async () => new Uint8Array([0]), put: async () => {throw new Error("quota");}};
    expect(await loadDisk({url: "https://retrom.test/disk", sha256: digest, sizeBytes: 3}, () => undefined, store)).toEqual(bytes);
    await expect(loadDisk({url: "https://retrom.test/disk", sha256: digest, sizeBytes: 4}, () => undefined, null)).rejects.toThrow("NP2KAI_DISK_INVALID");
  });
});
