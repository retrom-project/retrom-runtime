// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {reclaimContentCache} from "./reclaim.js";
import {CacheBlockStore} from "./cache-storage.js";
import {ContentGC} from "./gc.js";
import {ContentMetadata} from "./metadata.js";
import {OPFSStore} from "./opfs.js";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
function fixture() {
  const close = vi.fn(), metadata = new ContentMetadata({close, onversionchange: null} as unknown as IDBDatabase);
  const open = vi.spyOn(ContentMetadata, "openExisting").mockResolvedValue(metadata);
  const opfs = vi.spyOn(OPFSStore, "openExisting").mockResolvedValue(undefined);
  const cache = vi.spyOn(CacheBlockStore, "openExisting").mockResolvedValue(undefined);
  const collect = vi.spyOn(ContentGC.prototype, "collect").mockResolvedValue({reclaimedBytes: 512, removedObjects: 1});
  vi.stubGlobal("navigator", {locks: {}, storage: {estimate: vi.fn(() => {throw new Error("estimate is not an allocation guarantee");})}});
  vi.stubGlobal("location", {origin: "https://owned.test"});
  return {metadata, close, open, opfs, cache, collect};
}

it("reclaims current-origin content without a runtime, storage estimate, write probe or schema creation", async () => {
  const f = fixture();
  await expect(reclaimContentCache({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 512, removedObjects: 1});
  expect(f.open).toHaveBeenCalledExactlyOnceWith();
  expect(f.cache).toHaveBeenCalledExactlyOnceWith("https://owned.test");
  expect(f.collect).toHaveBeenCalledWith({targetBytes: 1, signal: expect.any(AbortSignal)});
  expect(navigator.storage.estimate).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
});

it("does not open backends or collect if the existing metadata database is absent", async () => {
  const f = fixture(); f.open.mockResolvedValue(undefined);
  await expect(reclaimContentCache({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0});
  expect(f.opfs).not.toHaveBeenCalled(); expect(f.cache).not.toHaveBeenCalled();
  expect(f.collect).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
});

it("performs no mutation if Web Locks is unavailable", async () => {
  const f = fixture(); vi.stubGlobal("navigator", {});
  await expect(reclaimContentCache({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0});
  expect(f.open).not.toHaveBeenCalled(); expect(f.collect).not.toHaveBeenCalled();
});

it("preserves an opening failure as the cause and closes metadata already opened", async () => {
  const f = fixture(), failure = new DOMException("denied", "NotAllowedError");
  f.opfs.mockRejectedValueOnce(failure);
  await expect(reclaimContentCache({targetBytes: 1})).rejects.toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE", cause: failure});
  expect(f.cache).not.toHaveBeenCalled(); expect(f.collect).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
});

it("waits for an in-flight metadata open after cancellation and closes its late handle before rejecting", async () => {
  const f = fixture(), controller = new AbortController();
  let finish!: (value: ContentMetadata) => void;
  f.open.mockReturnValue(new Promise(resolve => {finish = resolve;}));
  let settled = false;
  const operation = reclaimContentCache({targetBytes: 1, signal: controller.signal}).catch(error => error)
    .finally(() => {settled = true;});
  await Promise.resolve(); controller.abort("leaving"); await Promise.resolve();
  expect(settled).toBe(false); expect(f.close).not.toHaveBeenCalled();
  finish(f.metadata);
  expect(await operation).toMatchObject({code: "CONTENT_IO_ABORTED", cause: "leaving"});
  expect(f.close).toHaveBeenCalledOnce(); expect(f.opfs).not.toHaveBeenCalled();
});

it("awaits the collector's safe completion after cancellation instead of releasing metadata early", async () => {
  const f = fixture(), controller = new AbortController();
  let finish!: () => void;
  f.collect.mockImplementation(async () => {await new Promise<void>(resolve => {finish = resolve;});
    throw controller.signal.reason;
  });
  let settled = false;
  const operation = reclaimContentCache({targetBytes: 1, signal: controller.signal}).catch(error => error)
    .finally(() => {settled = true;});
  await vi.waitFor(() => expect(f.collect).toHaveBeenCalledOnce());
  const failure = new DOMException("leaving", "AbortError"); controller.abort(failure);
  await Promise.resolve(); expect(settled).toBe(false); expect(f.close).not.toHaveBeenCalled();
  finish();
  expect(await operation).toMatchObject({cause: failure}); expect(f.close).toHaveBeenCalledOnce();
});

it("rejects already-cancelled and invalid requests before opening anything", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort("leaving");
  await expect(reclaimContentCache({targetBytes: 1, signal: controller.signal})).rejects.toMatchObject({code: "CONTENT_IO_ABORTED"});
  for (const targetBytes of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(reclaimContentCache({targetBytes})).rejects.toMatchObject({code: "CONTENT_IO_SOURCE_INVALID"});
  }
  expect(f.open).not.toHaveBeenCalled();
});
