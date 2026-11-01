// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {clearContentCache, inspectContentCache} from "./management.js";
import {ContentGC} from "./gc.js";
import {ContentMetadata} from "./metadata.js";
import {OPFSStore} from "./opfs.js";
import {CacheBlockStore} from "./cache-storage.js";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
function fixture() {
  const metadata = new ContentMetadata({close: vi.fn(), onversionchange: null} as unknown as IDBDatabase);
  vi.stubGlobal("indexedDB", {databases: vi.fn()});
  vi.stubGlobal("navigator", {locks: {request: vi.fn()}});
  vi.stubGlobal("location", {origin: "https://owned.test"});
  const open = vi.spyOn(ContentMetadata, "openExisting").mockResolvedValue(metadata);
  const summary = vi.spyOn(ContentMetadata.prototype, "summary").mockResolvedValue({cachedBytes: 987, objectCount: 3});
  const close = vi.spyOn(metadata, "close");
  const opfs = vi.spyOn(OPFSStore, "openExisting").mockResolvedValue(undefined);
  const cache = vi.spyOn(CacheBlockStore, "openExisting").mockResolvedValue(undefined);
  return {open, summary, close, opfs, cache};
}

it("inspects only existing metadata without opening data backends or running write probes", async () => {
  const f = fixture();
  await expect(inspectContentCache()).resolves.toEqual({cachedBytes: 987, objectCount: 3, canClear: true});
  expect(f.summary).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce();
  expect(f.opfs).not.toHaveBeenCalled(); expect(f.cache).not.toHaveBeenCalled();
});

it("reports an empty existing-cache inventory without creating storage", async () => {
  const f = fixture(); f.open.mockResolvedValue(undefined);
  await expect(inspectContentCache()).resolves.toEqual({cachedBytes: 0, objectCount: 0, canClear: true});
  await expect(clearContentCache({})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0, skippedObjects: 0, nextKey: null});
  expect(f.summary).not.toHaveBeenCalled(); expect(f.opfs).not.toHaveBeenCalled(); expect(f.cache).not.toHaveBeenCalled();
});

it("does not misreport unsupported metadata discovery as zero cached bytes", async () => {
  const f = fixture(); vi.stubGlobal("indexedDB", {});
  await expect(inspectContentCache()).rejects.toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE"});
  expect(f.open).not.toHaveBeenCalled();
});

it("allows inspection without Web Locks but refuses unsafe clearing", async () => {
  const f = fixture(); vi.stubGlobal("navigator", {});
  await expect(inspectContentCache()).resolves.toEqual({cachedBytes: 987, objectCount: 3, canClear: false});
  await expect(clearContentCache({})).rejects.toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE"});
  expect(f.opfs).not.toHaveBeenCalled();
});

it("opens existing backends for one cancellable clear batch and preserves its cursor", async () => {
  const f = fixture(), afterKey = "a".repeat(64);
  const collect = vi.spyOn(ContentGC.prototype, "clear").mockResolvedValue({reclaimedBytes: 700, removedObjects: 2, skippedObjects: 1, nextKey: afterKey});
  await expect(clearContentCache({afterKey})).resolves.toEqual({reclaimedBytes: 700, removedObjects: 2, skippedObjects: 1, nextKey: afterKey});
  expect(collect).toHaveBeenCalledWith({afterKey, signal: expect.any(AbortSignal)});
  expect(f.cache).toHaveBeenCalledWith("https://owned.test"); expect(f.close).toHaveBeenCalledOnce();
});

it("rejects malformed cursors and cancellation before opening any storage", async () => {
  const f = fixture();
  await expect(clearContentCache({afterKey: "../saves"})).rejects.toMatchObject({code: "CONTENT_IO_SOURCE_INVALID"});
  await expect(inspectContentCache({signal: AbortSignal.abort()})).rejects.toMatchObject({code: "CONTENT_IO_ABORTED"});
  expect(f.open).not.toHaveBeenCalled();
});

it("closes metadata and retains the cause when a native operation fails", async () => {
  const f = fixture(), failure = new DOMException("denied", "NotAllowedError");
  f.opfs.mockRejectedValue(failure);
  await expect(clearContentCache({})).rejects.toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE", cause: failure});
  expect(f.close).toHaveBeenCalledOnce();
});
