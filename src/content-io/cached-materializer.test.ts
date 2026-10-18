// @vitest-environment node
import {expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {ContentMaterializer} from "./materializer.js";
import {ContentStoreManager} from "./store/manager.js";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {PersistentBacking} from "./store/backing.js";
import {ContentMetadata} from "./store/metadata.js";
import {ContentLocks} from "./store/locks.js";
import * as hashing from "./bounded-stream.js";
import type {GenerationRecord} from "./store/types.js";
import {WindowLoader} from "./window-loader.js";
import {fetchWindow, DEFAULT_FETCH_POLICY} from "./fetch-policy.js";

function fixture() {
  const bytes = Uint8Array.of(1, 2, 3), sha256 = createHash("sha256").update(bytes).digest("hex");
  const object: BlockObject = {key: "a".repeat(64), state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}, source: {
    identity: {kind: "FILE_SHA256", sha256}, sizeBytes: bytes.length, url: "https://example.test/game", purpose: "GAME",
    transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}};
  const generation: GenerationRecord = {objectKey: object.key, generation: crypto.randomUUID(), backend: "OPFS", state: "COMPLETE",
    pinnedEtag: null, completionAssurance: "EXPECTED_SHA256", localSha256: sha256, committedBytes: bytes.length, revision: 1, retiredAtMs: null};
  const metadata = new ContentMetadata({onversionchange: null} as IDBDatabase);
  vi.spyOn(metadata, "generation").mockResolvedValue(generation);
  const locks = new ContentLocks(); vi.spyOn(locks, "data").mockImplementation(async (_key, _signal, action) => action());
  const backing = new PersistentBacking({metadata, locks, data: {backend: "OPFS", location: () => "file",
    read: async () => bytes, write: async () => {}, remove: async () => {}}}, {
    generation, object: {key: object.key, ...generation, identity: object.source.identity, sizeBytes: bytes.length,
      purpose: "GAME", sourceOrigin: "https://example.test", lastAccessMs: 0}}, object);
  const pool = new BlockPool(0, async () => {throw new Error("unexpected network read");});
  const store = new ContentStoreManager("https://example.test", pool.credits);
  vi.spyOn(store, "prepare").mockResolvedValue(); vi.spyOn(store, "persistent").mockReturnValue(backing);
  // Complete cached bytes are intentionally trusted even if client storage changes later.
  vi.spyOn(store, "local").mockResolvedValue(Uint8Array.of(9, 2, 3));
  const materializer = new ContentMaterializer(pool, store);
  return {object, generation, materializer, store, pool, backing};
}

it("delivers a completed OPFS Blob by file reference without rereading its blocks", async () => {
  const {object, generation, materializer, store, pool, backing} = fixture();
  const file = new File([Uint8Array.of(1, 2, 3)], "verified.data"), release = vi.fn();
  const openFile = vi.fn(async () => file);
  Object.assign(backing.resources.data, {file: openFile});
  vi.spyOn(store, "lease").mockResolvedValue(release);
  try {
    const result = await materializer.prepare(object, {kind: "BLOB", maxBytes: 3});
    if (result.kind !== "BLOB") {throw new Error("wrong kind");}
    expect(result.blob).toBe(file); expect(result.receipt.localSha256).toBe(generation.localSha256);
    expect(store.local).not.toHaveBeenCalled(); expect(openFile).toHaveBeenCalledOnce();
    await result.release(); await result.release(); expect(release).toHaveBeenCalledOnce();
    expect(materializer.stats.materializedBytesByKind.BLOB).toBe(3);
  } finally {materializer.close(); store.close(); pool.close();}
});

it.each(["missing", "wrong-size"])("keeps the verified-byte fallback when the completed Blob file is %s", async failure => {
  const {object, materializer, store, pool, backing} = fixture();
  const release = vi.fn(), openFile = vi.fn(async () => {
    if (failure === "missing") {throw new DOMException("Missing file", "NotFoundError");}
    return new File([new Uint8Array(4)], "wrong.data");
  });
  Object.assign(backing.resources.data, {file: openFile});
  vi.spyOn(store, "lease").mockResolvedValue(release);
  vi.mocked(store.local).mockResolvedValue(Uint8Array.of(1, 2, 3));
  vi.spyOn(backing, "read").mockResolvedValue(Uint8Array.of(1, 2, 3));
  try {
    const result = await materializer.prepare(object, {kind: "BLOB", maxBytes: 3});
    if (result.kind !== "BLOB") {throw new Error("wrong kind");}
    expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([1, 2, 3]); expect(store.local).toHaveBeenCalledOnce();
    await result.release(); expect(release.mock.calls.length).toBe(openFile.mock.calls.length);
  } finally {materializer.close(); store.close(); pool.close();}
});

it("releases the Blob lease when cancellation interrupts file-reference delivery", async () => {
  const {object, materializer, store, pool, backing} = fixture(), controller = new AbortController();
  const release = vi.fn(); let finish!: (file: File) => void;
  const openFile = vi.fn(() => new Promise<File>(resolve => {finish = resolve;}));
  Object.assign(backing.resources.data, {file: openFile}); vi.spyOn(store, "lease").mockResolvedValue(release);
  try {
    const result = expect(materializer.prepare(object, {kind: "BLOB", maxBytes: 3}, controller.signal)).rejects.toThrow("ABORTED");
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledOnce()); controller.abort(); await result;
    finish(new File([new Uint8Array(3)], "late.data"));
    expect(release).toHaveBeenCalledOnce(); expect(store.local).not.toHaveBeenCalled();
  } finally {materializer.close(); store.close(); pool.close();}
});

it.each(["BYTES", "BLOB", "SINK"] as const)("[ST-10] UNIT/cached-%s reuses a completed receipt without scanning its content hash again", async kind => {
  const {object, materializer, store, pool, generation} = fixture();
  const incremental = vi.spyOn(hashing, "createContentHasher"), native = vi.spyOn(crypto.subtle, "digest");
  const commit = vi.fn(async () => {}), chunks: number[] = [];
  try {
    const result = await materializer.prepare(object, kind === "SINK" ? {kind, maxBytes: 3, createSink: async () => ({
      write: async (_offset, bytes) => {chunks.push(...bytes);}, commit, abort: async () => {}})} : {kind, maxBytes: 3});
    expect(result.receipt).toMatchObject({localSha256: generation.localSha256, storageGeneration: generation.generation, assurance: "EXPECTED_SHA256"});
    if (result.kind === "BYTES") {expect(result.bytes).toEqual(Uint8Array.of(9, 2, 3));}
    if (result.kind === "BLOB") {expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([9, 2, 3]); await result.release();}
    if (result.kind === "SINK") {expect(chunks).toEqual([9, 2, 3]); expect(commit).toHaveBeenCalledOnce();}
    expect(incremental).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  } finally {materializer.close(); store.close(); pool.close();}
});

it("[ST-10] UNIT/cached-window serves a complete cached small-file window without hashing its bytes again", async () => {
  const {object, materializer, store, pool} = fixture();
  const incremental = vi.spyOn(hashing, "createContentHasher");
  try {
    const loader = new WindowLoader(store, pool.cache, (object, index) => pool.key(object, index));
    const bytes = await loader.load(object, fetchWindow(3, 0, DEFAULT_FETCH_POLICY), new AbortController().signal);
    expect(bytes).toEqual(Uint8Array.of(9, 2, 3)); expect(incremental).not.toHaveBeenCalled();
  } finally {materializer.close(); store.close(); pool.close();}
});

it.each([false, true])("[ST-11] UNIT/cached-fallback-%s verifies replacement bytes after a complete-cache read fails", async changed => {
  const {object, materializer, store, pool} = fixture();
  const incremental = vi.spyOn(hashing, "createContentHasher");
  vi.mocked(store.local).mockImplementation(async () => {vi.mocked(store.persistent).mockReturnValue(undefined); return null;});
  const network = vi.spyOn(pool, "copy").mockImplementation(async (_object, _index, _offset, target) => {
    target.set(Uint8Array.of(changed ? 9 : 1, 2, 3));
  });
  try {
    const result = materializer.prepare(object, {kind: "BYTES", maxBytes: 3});
    if (changed) {await expect(result).rejects.toMatchObject({code: "CONTENT_IO_CHECKSUM_MISMATCH"});}
    else {expect(await result).toMatchObject({kind: "BYTES", bytes: Uint8Array.of(1, 2, 3)});}
    expect(incremental).toHaveBeenCalledOnce(); expect(network).toHaveBeenCalledOnce();
  } finally {materializer.close(); store.close(); pool.close();}
});
