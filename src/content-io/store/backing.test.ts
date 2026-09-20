// @vitest-environment node
import {expect, it, vi} from "vitest";
import {completeBacking} from "./complete.js";
import {BufferCredits} from "../credits.js";
import {ContentIOError} from "../errors.js";
import {PersistentBacking, localDigest} from "./backing.js";
import {ContentMetadata} from "./metadata.js";
import {ContentLocks} from "./locks.js";
import type {BlockObject} from "../block-pool.js";
import type {BlockReceipt, GenerationRecord, DataStore} from "./types.js";

function fixture() {
  const bytes = new Uint8Array([17, 31]);
  const source: BlockObject = {key: "a".repeat(64), source: {identity: {kind: "FILE_SHA256", sha256: localDigest(bytes)},
    sizeBytes: 2, url: "https://game.test/file", purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256",
    contentLengthPolicy: "EXACT_IF_PRESENT", }, state: {generation: "gen", pinnedEtag: null, revoked: false}};
  const generation: GenerationRecord = {objectKey: source.key, generation: "gen", backend: "OPFS", state: "COMPLETE",
    pinnedEtag: null, completionAssurance: "EXPECTED_SHA256", localSha256: localDigest(bytes), committedBytes: 2, revision: 1, retiredAtMs: null};
  const receipt: BlockReceipt = {objectKey: source.key, generation: "gen", backend: "OPFS", index: 0, length: 2,
    localSha256: localDigest(bytes), etag: null, provenance: "FULL_VERIFIED", sourceAssurance: "EXPECTED_ETAG", location: "file", commitRevision: 1};
  const metadata = new ContentMetadata({onversionchange: null} as IDBDatabase);
  vi.spyOn(metadata, "generation").mockResolvedValue(generation); vi.spyOn(metadata, "block").mockResolvedValue(receipt);
  const update = vi.spyOn(metadata, "update").mockResolvedValue(generation);
  const locks = new ContentLocks(); vi.spyOn(locks, "data").mockImplementation(async (_key, _signal, action) => action());
  const read = vi.fn(async () => bytes), write = vi.fn(async () => {});
  const data: DataStore = {backend: "OPFS", location: () => "file", read, write, remove: async () => {}};
  const object = {key: source.key, ...generation, identity: source.source.identity, sizeBytes: 2, purpose: source.source.purpose,
    sourceOrigin: "https://game.test", lastAccessMs: 0};
  const corrupt = vi.fn();
  return {backing: new PersistentBacking({metadata, locks, data}, {object, generation}, source, corrupt), read, write, update, receipt, generation, corrupt};
}
it("[ST-10] UNIT/backend-read-failure does not quarantine a complete generation on transient I/O failure", async () => {
  const {backing, read, update, corrupt} = fixture(), failure = new DOMException("temporarily unavailable", "NotReadableError");
  read.mockRejectedValue(failure);
  await expect(backing.read(0, new AbortController().signal)).rejects.toBe(failure);
  expect(update).not.toHaveBeenCalled(); expect(corrupt).not.toHaveBeenCalled();
});
it("[IO-18] UNIT/published-corruption quarantines confirmed byte corruption", async () => {
  const {backing, read, update, corrupt} = fixture(); read.mockResolvedValue(new Uint8Array([17, 32]));
  await expect(backing.read(0, new AbortController().signal)).rejects.toThrow("IDENTITY_CHANGED");
  expect(update).toHaveBeenCalledOnce(); expect(corrupt).toHaveBeenCalledOnce();
});

for (const invalid of [{etag: '"other"'}, {sourceAssurance: "FULL_SHA256" as const}, {commitRevision: 0}, {commitRevision: 2}]) {
  it(`[ST-07] UNIT/receipt rejects mismatched identity or uncommitted metadata ${JSON.stringify(invalid)}`, async () => {
    const {backing, read, receipt} = fixture(); Object.assign(receipt, invalid);
    expect(await backing.read(0, new AbortController().signal)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
}

it("[X-24] UNIT/complete-immutable never rewrites a published generation for late whole or Range writes", async () => {
  const {backing, write, update} = fixture();
  const signal = new AbortController().signal;
  await backing.write(0, new Uint8Array([17, 31]), signal, "STAGED_FULL");
  await backing.write(0, new Uint8Array([17, 31]), signal, "RANGE_VALIDATED");
  await expect(backing.write(0, new Uint8Array([17, 32]), signal)).rejects.toThrow("IDENTITY_CHANGED");
  expect(write).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
});

it("[X-22] UNIT/completion-credit-failure leaves no cache deadline after a rejected buffer reservation", async () => {
  const {backing, generation, receipt} = fixture(); generation.state = "PARTIAL";
  const credits = new BufferCredits(); vi.spyOn(credits, "reserve").mockRejectedValueOnce(new ContentIOError("ABORTED"));
  vi.useFakeTimers();
  try {
    await expect(completeBacking(backing, {objectKey: backing.key, storageGeneration: backing.generation, sizeBytes: 2,
      localSha256: receipt.localSha256, assurance: "EXPECTED_SHA256", pinnedEtag: null}, credits, new AbortController().signal)).rejects.toThrow("ABORTED");
    expect(vi.getTimerCount()).toBe(0);
  } finally {vi.useRealTimers();}
});
