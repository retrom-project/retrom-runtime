// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {ContentMetadata} from "./metadata.js";
import {CacheBlockStore} from "./cache-storage.js";
import {OPFSStore} from "./opfs.js";
import {namespace} from "./types.js";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
function database() {
  const db = {version: 1, objectStoreNames: {contains: (name: string) => ["objects", "generations", "blocks", "jobs"].includes(name)},
    close: vi.fn(), onversionchange: null};
  const request = {result: db, error: new DOMException("open failed", "UnknownError"), transaction: {abort: vi.fn()},
    onsuccess: null as (() => void) | null, onerror: null as (() => void) | null,
    onblocked: null as (() => void) | null, onupgradeneeded: null as (() => void) | null};
  const factory = {databases: vi.fn(async () => [{name: namespace, version: 1}]), open: vi.fn(() => request)};
  vi.stubGlobal("indexedDB", factory);
  return {db, request, factory};
}

it("does not open or create a metadata database that does not already exist", async () => {
  const f = database(); f.factory.databases.mockResolvedValue([]);
  await expect(ContentMetadata.openExisting()).resolves.toBeUndefined();
  expect(f.factory.open).not.toHaveBeenCalled();
});

it("opens the existing version without a schema upgrade or write probe", async () => {
  const f = database(), opening = ContentMetadata.openExisting();
  await vi.waitFor(() => expect(f.request.onsuccess).toBeTypeOf("function"));
  f.request.onsuccess!(); const metadata = await opening;
  expect(f.factory.open).toHaveBeenCalledExactlyOnceWith(namespace);
  expect(f.request.transaction.abort).not.toHaveBeenCalled();
  metadata!.close(); expect(f.db.close).toHaveBeenCalledOnce();
});

it("aborts database creation if the namespace disappears between listing and opening", async () => {
  const f = database(), opening = ContentMetadata.openExisting();
  await vi.waitFor(() => expect(f.request.onupgradeneeded).toBeTypeOf("function"));
  f.request.onupgradeneeded!(); f.request.onerror!();
  await expect(opening).resolves.toBeUndefined();
  expect(f.request.transaction.abort).toHaveBeenCalledOnce(); expect(f.db.close).toHaveBeenCalledOnce();
});

it("closes a late database handle if a blocked open was already rejected", async () => {
  const f = database(), opening = ContentMetadata.openExisting();
  await vi.waitFor(() => expect(f.request.onblocked).toBeTypeOf("function"));
  const failed = expect(opening).rejects.toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE"});
  f.request.onblocked!(); await failed;
  f.request.onsuccess!(); expect(f.db.close).toHaveBeenCalledOnce();
});

it("rejects an unexpected existing schema and preserves native open errors", async () => {
  const f = database(); f.db.version = 2;
  const opening = ContentMetadata.openExisting();
  await vi.waitFor(() => expect(f.request.onsuccess).toBeTypeOf("function"));
  const failed = expect(opening).rejects.toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE"});
  f.request.onsuccess!(); await failed; expect(f.db.close).toHaveBeenCalledOnce();
  const next = database(), rejected = ContentMetadata.openExisting();
  await vi.waitFor(() => expect(next.request.onerror).toBeTypeOf("function"));
  const native = expect(rejected).rejects.toBe(next.request.error);
  next.request.onerror!(); await native;
});

it("does not create an absent CacheStorage namespace or perform a write probe", async () => {
  const caches = {has: vi.fn(async () => false), open: vi.fn(), delete: vi.fn()}; vi.stubGlobal("caches", caches);
  await expect(CacheBlockStore.openExisting("https://game.test")).resolves.toBeUndefined();
  expect(caches.has).toHaveBeenCalledExactlyOnceWith(namespace);
  expect(caches.open).not.toHaveBeenCalled(); expect(caches.delete).not.toHaveBeenCalled();
});

it("opens and removes only an existing OPFS content object without creating any directory", async () => {
  const objects = {removeEntry: vi.fn(async () => {})};
  const content = {getDirectoryHandle: vi.fn(async () => objects)};
  const root = {getDirectoryHandle: vi.fn(async () => content)};
  vi.stubGlobal("navigator", {storage: {getDirectory: vi.fn(async () => root)}});
  const store = (await OPFSStore.openExisting())!, key = "a".repeat(64);
  await store.remove(key, []);
  expect(root.getDirectoryHandle).toHaveBeenCalledExactlyOnceWith(namespace);
  expect(content.getDirectoryHandle).toHaveBeenCalledExactlyOnceWith("objects");
  expect(objects.removeEntry).toHaveBeenCalledExactlyOnceWith(key, {recursive: true});
});

it("ignores absent OPFS content but preserves permission errors", async () => {
  const getDirectoryHandle = vi.fn().mockRejectedValue(new DOMException("missing", "NotFoundError"));
  vi.stubGlobal("navigator", {storage: {getDirectory: async () => ({getDirectoryHandle})}});
  await expect(OPFSStore.openExisting()).resolves.toBeUndefined();
  const failure = new DOMException("denied", "NotAllowedError"); getDirectoryHandle.mockRejectedValue(failure);
  await expect(OPFSStore.openExisting()).rejects.toBe(failure);
});

it("removes only the exact object's known CacheStorage generations and propagates a partial failure", async () => {
  const key = "a".repeat(64), otherKey = "b".repeat(64), generation = "00000000-0000-4000-8000-000000000000";
  const cache = {keys: vi.fn(async () => requests), delete: vi.fn(async (_request: Request) => true)};
  const store = new CacheBlockStore(cache as unknown as Cache, "https://game.test");
  const requests = [new Request(store.location(key, generation, 0)), new Request(store.location(key, generation, 1)),
    new Request(store.location(otherKey, generation, 0)), new Request("https://game.test/pwa-shell"),
    new Request(store.location(key, "11111111-1111-4111-8111-111111111111", 0))];
  const failure = new DOMException("delete failed", "UnknownError");
  cache.delete.mockResolvedValueOnce(true).mockRejectedValueOnce(failure);
  await expect(store.remove(key, [generation])).rejects.toBe(failure);
  expect(cache.keys).toHaveBeenCalledOnce();
  expect(cache.delete.mock.calls.map(([request]) => request.url)).toEqual(requests.slice(0, 2).map(request => request.url));
});
