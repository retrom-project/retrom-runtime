// @vitest-environment node
import {createHash} from "node:crypto";
import {expect, it, vi} from "vitest";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {ContentMaterializer} from "./materializer.js";
import {ContentStoreManager} from "./store/manager.js";
import {ContentMetadata} from "./store/metadata.js";
import {ContentLocks} from "./store/locks.js";
import {StoreSelector} from "./store/selector.js";
import {ContentGC} from "./store/gc.js";
import type {Backing, BlockReceipt, GenerationRecord} from "./store/types.js";

it("quarantines failed whole-file verification so a new session can retry and then reuse the verified asset", async () => {
  const expected = Uint8Array.from({length: 786449}, (_, i) => i % 251);
  const digest = createHash("sha256").update(expected).digest("hex");
  const source: BlockObject["source"] = {identity: {kind: "FILE_SHA256", sha256: digest}, sizeBytes: expected.length,
    url: "https://example.test/core.data", purpose: "CORE_ASSET", transport: "WHOLE_ALLOWED",
    etagPolicy: "NONE_FULL_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"};
  const generations = new Map<string, GenerationRecord>(), receipts = new Map<string, BlockReceipt>();
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  let current: Backing | undefined;
  const metadata = new ContentMetadata({onversionchange: null} as IDBDatabase);
  vi.spyOn(metadata, "attach").mockImplementation(async key => {
    if (current && current.generation.state !== "QUARANTINED") {return structuredClone(current);}
    const generation: GenerationRecord = {objectKey: key, generation: crypto.randomUUID(), backend: "OPFS", state: "PARTIAL",
      pinnedEtag: null, completionAssurance: null, localSha256: null, committedBytes: 0, revision: 0, retiredAtMs: null};
    generations.set(generation.generation, generation);
    current = {generation, object: {key, ...generation, identity: source.identity, sizeBytes: source.sizeBytes,
      purpose: source.purpose, sourceOrigin: "https://example.test", lastAccessMs: 0}};
    return structuredClone(current);
  });
  vi.spyOn(metadata, "generation").mockImplementation(async (_key, id) => structuredClone(generations.get(id)));
  vi.spyOn(metadata, "generations").mockImplementation(async () => structuredClone([...generations.values()]));
  vi.spyOn(metadata, "block").mockImplementation(async (_key, id, index) => structuredClone(receipts.get(`${id}:${index}`)));
  vi.spyOn(metadata, "update").mockImplementation(async (_key, id, revision, change, block) => {
    const record = generations.get(id)!;
    if (record.revision !== revision || record.state === "QUARANTINED") {throw new Error("invalid metadata update");}
    change(record); record.revision++;
    if (block && !("deleteIndex" in block)) {receipts.set(`${id}:${block.index}`, {...block, commitRevision: record.revision});}
    return structuredClone(record);
  });
  const locks = new ContentLocks();
  vi.spyOn(locks, "data").mockImplementation(async (_key, _signal, action) => action());
  vi.spyOn(locks, "use").mockResolvedValue(() => {});
  vi.spyOn(ContentGC.prototype, "collect").mockResolvedValue(0);
  vi.spyOn(StoreSelector.prototype, "select").mockResolvedValue({metadata, locks, data: {
    backend: "OPFS", location: (_key, id, index) => `${id}:${index}`,
    read: async receipt => files.get(receipt.location)!.slice(),
    write: async (receipt, bytes) => {files.set(receipt.location, bytes.slice());}, remove: async () => {},
  }});
  let corrupt = true;
  const network = vi.fn(async () => {
    const bytes = expected.slice(); if (corrupt) {bytes[400000] ^= 1;}
    const response = new Response(bytes, {headers: {"Content-Length": String(bytes.length)}});
    Object.defineProperty(response, "url", {value: source.url}); return response;
  });
  vi.stubGlobal("fetch", network);
  const launch = async () => {
    const object: BlockObject = {key: "a".repeat(64), source, state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}};
    const pool = new BlockPool(0), store = new ContentStoreManager("https://example.test", pool.credits);
    const materializer = new ContentMaterializer(pool, store);
    try {return await materializer.prepare(object, {kind: "BYTES", maxBytes: source.sizeBytes});}
    finally {materializer.close(); store.close(); pool.close();}
  };
  try {
    await expect(launch()).rejects.toThrow("CHECKSUM_MISMATCH");
    expect([...generations.values()].map(record => record.state)).toEqual(["QUARANTINED"]);
    corrupt = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await launch();
      expect(result.kind).toBe("BYTES");
      if (result.kind !== "BYTES") {throw new Error("unexpected result");}
      expect(createHash("sha256").update(result.bytes).digest("hex")).toBe(digest);
    }
    expect(network).toHaveBeenCalledTimes(2);
  } finally {vi.unstubAllGlobals();}
});
