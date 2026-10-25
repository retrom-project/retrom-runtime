// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {ContentGC} from "./gc.js";
import {ContentIOError} from "../errors.js";
import type {ContentMetadata} from "./metadata.js";
import type {ContentLocks} from "./locks.js";
import type {DataStore, GenerationRecord, JobRecord, ObjectRecord} from "./types.js";

afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
function deferred() {
  let resolve!: () => void;
  return {promise: new Promise<void>(finish => {resolve = finish;}), resolve: () => resolve()};
}

function fixture(states: ObjectRecord["state"][] = ["COMPLETE", "PARTIAL"]) {
  const objects = states.map((state, index): ObjectRecord => ({
    key: (index + 1).toString(16).padStart(64, "0"),
    identity: {kind: "FILE_SHA256", sha256: "c".repeat(64)},
    purpose: "GAME", sourceOrigin: "https://games.test", sizeBytes: 128,
    generation: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    backend: "CACHE_BLOCKS", state, pinnedEtag: null, revision: 1,
    completionAssurance: state === "COMPLETE" ? "EXPECTED_SHA256" : null,
    localSha256: state === "COMPLETE" ? "c".repeat(64) : null,
    committedBytes: 128, lastAccessMs: index,
  }));
  const generations = new Map(objects.map(object => [object.key, [{...object, objectKey: object.key, retiredAtMs: null}] as GenerationRecord[]]));
  const jobs = new Map<string, JobRecord[]>();
  const metadata = {
    list: vi.fn(async (limit: number, state?: ObjectRecord["state"]) =>
      objects.filter(object => !state || state === object.state).slice(0, limit).map(object => ({...object}))),
    object: vi.fn(async (key: string) => structuredClone(objects.find(object => object.key === key))),
    generations: vi.fn(async (key: string, limit?: number) => structuredClone(generations.get(key)?.slice(0, limit) ?? [])),
    jobs: vi.fn(async (key: string, limit: number) => structuredClone(jobs.get(key)?.slice(0, limit) ?? [])),
    update: vi.fn(async (key: string, generation: string, revision: number,
      change: (record: GenerationRecord) => void) => {
      const record = generations.get(key)!.find(record => record.generation === generation)!;
      if (revision !== record.revision) {throw new ContentIOError("CACHE_UNAVAILABLE");}
      change(record); record.revision++;
      const object = objects.find(object => object.key === key)!;
      if (object.generation === generation) {Object.assign(object, record);}
      return structuredClone(record);
    }),
    remove: vi.fn(async (_key: string) => {}),
  };
  const held = new Set<string>(), active = new Set<string>();
  const locks = {
    gc: vi.fn(async <T>(key: string, action: () => Promise<T>) => {
      if (active.has(key)) {return undefined;}
      held.add(key);
      try {return await action();} finally {held.delete(key);}
    }),
    data: vi.fn(async <T>(_key: string, _signal: AbortSignal | undefined, action: () => Promise<T>) => action()),
  };
  const remove = vi.fn(async (_key: string, _generations: readonly string[]) => {});
  const store: DataStore = {backend: "CACHE_BLOCKS", location: () => "unused", read: async () => new Uint8Array(),
    write: async () => {}, remove};
  const stores = [store];
  const gc = new ContentGC(metadata as unknown as ContentMetadata, locks as unknown as ContentLocks, stores);
  return {gc, metadata, locks, store, stores, remove, objects, generations, jobs, active, held};
}

it("reclaims an idle complete object on actual storage pressure even when estimate claims free space", async () => {
  const f = fixture();
  vi.stubGlobal("navigator", {storage: {estimate: async () => ({quota: 18_000_000_000, usage: 7_000_000_000})}});
  // Existing collect ignores this pressure request and retains the complete object.
  await expect(f.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 128, removedObjects: 1});
  expect(f.remove).toHaveBeenCalledExactlyOnceWith(f.objects[0].key, [f.objects[0].generation]);
  expect(f.metadata.remove).toHaveBeenCalledExactlyOnceWith(f.objects[0].key);
});

it("skips a live use lease and reclaims the next idle partial object as a whole", async () => {
  const f = fixture(); f.active.add(f.objects[0].key);
  await f.gc.collect({targetBytes: 1});
  expect(f.remove).toHaveBeenCalledExactlyOnceWith(f.objects[1].key, [f.objects[1].generation]);
});

it("invalidates the complete declaration before a physical delete can fail", async () => {
  const f = fixture(["COMPLETE"]), failure = new DOMException("physical delete failed", "UnknownError");
  f.remove.mockImplementation(async () => {
    expect(f.objects[0].state).not.toBe("COMPLETE");
    expect(f.held.has(f.objects[0].key)).toBe(true);
    throw failure;
  });
  await expect(f.gc.collect({targetBytes: 1})).rejects.toBe(failure);
  expect(f.metadata.remove).not.toHaveBeenCalled();
});

it("needs no metadata put to reclaim an existing partial object at exhausted quota", async () => {
  const f = fixture(["PARTIAL"]);
  f.metadata.update.mockRejectedValue(new DOMException("full", "QuotaExceededError"));
  await expect(f.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 128, removedObjects: 1});
  expect(f.metadata.update).not.toHaveBeenCalled();
  expect(f.metadata.remove).toHaveBeenCalledOnce();
});

it("invalidates every completed generation, including retired ones, before either backend is removed", async () => {
  const f = fixture(["COMPLETE"]), object = f.objects[0], records = f.generations.get(object.key)!;
  records.push({...records[0], generation: "11111111-1111-4111-8111-111111111111", backend: "OPFS", retiredAtMs: 1});
  const remove = vi.fn(async () => {
    expect(records.map(record => [record.state, record.completionAssurance, record.localSha256]))
      .toEqual([["PARTIAL", null, null], ["PARTIAL", null, null]]);
    expect(f.metadata.remove).not.toHaveBeenCalled();
  });
  f.stores.push({...f.store, backend: "OPFS", remove});
  f.remove.mockImplementation(remove);
  await expect(f.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 256, removedObjects: 1});
  expect(f.metadata.update).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(f.metadata.remove).toHaveBeenCalledOnce();
});

it("does not start any physical deletion when invalidation fails halfway through multiple generations", async () => {
  const f = fixture(["COMPLETE"]), records = f.generations.get(f.objects[0].key)!;
  records.push({...records[0], generation: "11111111-1111-4111-8111-111111111111"});
  const failure = new ContentIOError("CACHE_UNAVAILABLE", {cause: new DOMException("full", "QuotaExceededError")});
  f.metadata.update.mockImplementationOnce(async (_key, _gen, _rev, change) => {change(records[0]); return records[0];})
    .mockRejectedValueOnce(failure);
  await expect(f.gc.collect({targetBytes: 1})).rejects.toBe(failure);
  expect(records.map(record => record.state)).toEqual(["PARTIAL", "COMPLETE"]);
  expect(f.remove).not.toHaveBeenCalled(); expect(f.metadata.remove).not.toHaveBeenCalled();
});

for (const changed of ["revision", "generation", "lastAccessMs"] as const) {
  it(`skips an object whose ${changed} changed after candidate selection`, async () => {
    const f = fixture(["PARTIAL"]);
    f.metadata.object.mockImplementation(async () => ({...f.objects[0], [changed]: changed === "generation"
      ? "11111111-1111-4111-8111-111111111111" : 2}));
    await expect(f.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0});
    expect(f.remove).not.toHaveBeenCalled();
  });
}

it("skips active jobs even when no reader currently holds the use lease", async () => {
  const f = fixture(["PARTIAL"]), object = f.objects[0];
  f.jobs.set(object.key, [{jobId: "job", objectKey: object.key, generation: object.generation, ownerSession: "other",
    state: "ACTIVE", wholeRestartCount: 0, updatedAtMs: 1}]);
  await expect(f.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0});
  expect(f.remove).not.toHaveBeenCalled();
});

it("retains an object if any generation's physical backend is unavailable", async () => {
  const f = fixture(["COMPLETE"]);
  f.generations.get(f.objects[0].key)![0].backend = "OPFS";
  await expect(f.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0});
  expect(f.metadata.update).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
});

it("bounds candidate traversal and stops after at most 64 whole objects", async () => {
  const f = fixture(Array.from({length: 600}, () => "PARTIAL"));
  await expect(f.gc.collect({targetBytes: 1_000_000})).resolves.toEqual({reclaimedBytes: 64 * 128, removedObjects: 64});
  expect(f.metadata.list).toHaveBeenCalledExactlyOnceWith(512);
  expect(f.metadata.object).toHaveBeenCalledTimes(64);
  const leased = fixture(Array.from({length: 600}, () => "PARTIAL"));
  for (const object of leased.objects.slice(0, 512)) {leased.active.add(object.key);}
  await expect(leased.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0});
  expect(leased.locks.gc).toHaveBeenCalledTimes(512); expect(leased.remove).not.toHaveBeenCalled();
});

it("skips an object with more than the bounded number of generations or jobs", async () => {
  const f = fixture(["PARTIAL", "PARTIAL"]);
  f.generations.set(f.objects[0].key, Array.from({length: 129}, () => f.generations.get(f.objects[0].key)![0]));
  f.jobs.set(f.objects[1].key, Array.from({length: 129}, () => ({jobId: "done", objectKey: f.objects[1].key,
    generation: f.objects[1].generation, ownerSession: "old", state: "COMPLETE", wholeRestartCount: 0, updatedAtMs: 1})));
  await expect(f.gc.collect({targetBytes: 1})).resolves.toEqual({reclaimedBytes: 0, removedObjects: 0});
  expect(f.metadata.generations).toHaveBeenCalledWith(f.objects[0].key, 129);
  expect(f.metadata.jobs).toHaveBeenCalledWith(f.objects[1].key, 129);
  expect(f.remove).not.toHaveBeenCalled();
});

for (const expired of ["cancel", "deadline"] as const) {
  it(`drains actual physical removal and metadata under the locks after ${expired}, then admits no other object`, async () => {
    if (expired === "deadline") {vi.useFakeTimers();}
    const f = fixture(["COMPLETE", "PARTIAL"]), controller = new AbortController();
    const physical = deferred(), metadata = deferred(), entered = deferred(), deleted = deferred();
    f.remove.mockImplementation(async () => {entered.resolve(); await physical.promise;});
    f.metadata.remove.mockImplementation(async () => {deleted.resolve(); await metadata.promise;});
    let settled = false;
    const outcome = f.gc.collect({targetBytes: 129, signal: controller.signal}).catch(error => error).finally(() => {settled = true;});
    await entered.promise;
    if (expired === "cancel") {controller.abort("leaving");} else {await vi.advanceTimersByTimeAsync(5001);}
    await Promise.resolve();
    expect(settled).toBe(false); expect(f.held.has(f.objects[0].key)).toBe(true);
    physical.resolve(); await deleted.promise;
    expect(settled).toBe(false); expect(f.held.has(f.objects[0].key)).toBe(true);
    metadata.resolve();
    expect(await outcome).toMatchObject({code: expired === "cancel" ? "CONTENT_IO_ABORTED" : "CONTENT_IO_TIMEOUT"});
    expect(f.held.size).toBe(0); expect(f.remove).toHaveBeenCalledOnce();
  });
}

it("retains partial metadata and the original cause when final metadata deletion fails", async () => {
  const f = fixture(["COMPLETE"]), failure = new DOMException("metadata delete failed", "UnknownError");
  f.metadata.remove.mockRejectedValueOnce(failure);
  await expect(f.gc.collect({targetBytes: 1})).rejects.toBe(failure);
  expect(f.remove).toHaveBeenCalledOnce(); expect(f.objects[0].state).toBe("PARTIAL");
});

it("rejects malformed generation paths before invalidation or physical deletion", async () => {
  const f = fixture(["COMPLETE"]);
  f.generations.get(f.objects[0].key)![0].generation = "../../savedata";
  await expect(f.gc.collect({targetBytes: 1})).rejects.toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE"});
  expect(f.metadata.update).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
});

it("performs no storage work when already cancelled or given an invalid target", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await expect(f.gc.collect({targetBytes: 1, signal: controller.signal})).rejects.toMatchObject({code: "CONTENT_IO_ABORTED"});
  for (const targetBytes of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(f.gc.collect({targetBytes})).rejects.toMatchObject({code: "CONTENT_IO_SOURCE_INVALID"});
  }
  expect(f.metadata.list).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
});
