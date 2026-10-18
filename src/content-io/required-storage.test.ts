// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {ContentStoreManager} from "./store/manager.js";
import {BufferCredits} from "./credits.js";
import type {BlockObject} from "./block-pool.js";
import type {PersistentResources} from "./store/selector.js";
import type {GenerationRecord} from "./store/types.js";

const selected = vi.hoisted(() => ({resources: null as PersistentResources | null}));
vi.mock("./bounded-stream.js", async importOriginal => ({
  ...await importOriginal<typeof import("./bounded-stream.js")>(),
  hashBytes: async () => "c".repeat(64),
}));
vi.mock("./store/selector.js", () => ({StoreSelector: class {
  availableStores = [];
  async select() {return selected.resources;}
  async degrade() {return null;}
  close() {}
}}));
afterEach(() => {vi.useRealTimers(); selected.resources = null;});

it("uses the preparation budget only while materializations hold it", () => {
  const manager = new ContentStoreManager("https://example.test", new BufferCredits());
  expect(manager.operationTimeoutMs).toBe(500);
  const first = manager.materializing(), second = manager.materializing();
  expect(manager.operationTimeoutMs).toBe(5000);
  first(); first(); expect(manager.operationTimeoutMs).toBe(5000);
  second(); expect(manager.operationTimeoutMs).toBe(500);
  manager.close();
});

it("lets a required preload commit a healthy slow write while optional reads retain their fast fallback", async () => {
  vi.useFakeTimers();
  for (const requirement of ["OPTIONAL", "REQUIRED"] as const) {
    const f = fixture(), manager = new ContentStoreManager("https://example.test", new BufferCredits(), undefined, undefined, requirement);
    let settled = false;
    const saving = manager.saveBlock(f.object, 0, new Uint8Array([1, 2, 3]), new AbortController().signal).then(() => {settled = true;});
    await vi.advanceTimersByTimeAsync(501);
    expect(settled, requirement).toBe(requirement === "OPTIONAL");
    await vi.advanceTimersByTimeAsync(100); await saving;
    expect(manager.stats.degraded, requirement).toBe(requirement === "OPTIONAL");
    expect(f.record.committedBytes, requirement).toBe(requirement === "REQUIRED" ? 3 : 0);
    manager.close();
  }
});

it("cancels a required storage write without waiting for its preparation budget", async () => {
  vi.useFakeTimers();
  const f = fixture(), controller = new AbortController();
  const manager = new ContentStoreManager("https://example.test", new BufferCredits(), undefined, undefined, "REQUIRED");
  const saving = expect(manager.saveBlock(f.object, 0, new Uint8Array([1, 2, 3]), controller.signal)).rejects.toThrow("ABORTED");
  await vi.advanceTimersByTimeAsync(50); controller.abort(); await saving;
  await vi.advanceTimersByTimeAsync(600);
  expect(f.record.committedBytes).toBe(0); manager.close();
});

it("still bounds an unresponsive required backend", async () => {
  vi.useFakeTimers();
  const f = fixture(6000), manager = new ContentStoreManager("https://example.test", new BufferCredits(), undefined, undefined, "REQUIRED");
  const saving = manager.saveBlock(f.object, 0, new Uint8Array([1, 2, 3]), new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5001); await saving;
  expect(manager.stats.degraded).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.record.committedBytes).toBe(0); manager.close();
});

function fixture(writeDelay = 600) {
  const record: GenerationRecord = {objectKey: "a".repeat(64), generation: "00000000-0000-4000-8000-000000000000",
    backend: "OPFS", state: "PARTIAL", pinnedEtag: null, completionAssurance: null,
    localSha256: null, committedBytes: 0, revision: 0, retiredAtMs: null};
  const object: BlockObject = {key: record.objectKey, source: {
    identity: {kind: "FILE_SHA256", sha256: "b".repeat(64)}, sizeBytes: 3, url: "https://example.test/game",
    purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT",
  }, state: {generation: record.generation, pinnedEtag: null, revoked: false}};
  selected.resources = {
    locks: {use: async () => () => {}, data: async (_key: string, _signal: AbortSignal, action: () => Promise<unknown>) => action()},
    metadata: {
      attach: async () => ({object: {...record, key: object.key}, generation: {...record}}),
      generation: async () => ({...record}), generations: async () => [], list: async () => [],
      block: async () => undefined,
      update: async (_key: string, _generation: string, _revision: number, change: (record: GenerationRecord) => void) => {
        change(record); record.revision++; return {...record};
      }, close: () => {},
    },
    data: {backend: "OPFS", location: () => "file", write: async () => new Promise<void>(resolve => setTimeout(resolve, writeDelay))},
  } as unknown as PersistentResources;
  return {object, record};
}
