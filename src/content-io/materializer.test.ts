// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {ContentStoreManager} from "./store/manager.js";
import * as abort from "./abort.js";
import {ContentIOError} from "./errors.js";
import {ManagementJobs} from "./management-jobs.js";
import {base} from "./bridge/protocol.js";
import {ContentMaterializer} from "./materializer.js";
import type {ContentMessageV1, MaterializeSinkV1} from "../../contracts/content-io/v1/content-io.js";
function deferred() {let resolve!: () => void; const promise = new Promise<void>((done) => {resolve = done;}); return {promise, resolve};}
const owners: {pool: BlockPool; store: ContentStoreManager; materializer: ContentMaterializer}[] = [];
function setup(bytes: Uint8Array, declared = bytes) {
  const object: BlockObject = {key: "a".repeat(64), state: {generation: crypto.randomUUID(), revoked: false, pinnedEtag: null}, source: {
    identity: {kind: "FILE_SHA256", sha256: createHash("sha256").update(declared).digest("hex")}, sizeBytes: bytes.length,
    url: "https://example.test/game", purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", }};
  const pool: BlockPool = new BlockPool(0, (object, index, signal) => store.read(object, index, signal), undefined, (object, signal) => store.prepare(object, signal));
  const store: ContentStoreManager = new ContentStoreManager("https://example.test", pool.credits);
  const materializer = new ContentMaterializer(pool, store); owners.push({pool, store, materializer});
  const fetcher = vi.fn(async () => {
    const response = new Response(Uint8Array.from(bytes), {status: 200, headers: {"Content-Length": String(bytes.length), ETag: `"sha256-${object.source.identity.kind === "FILE_SHA256" ? object.source.identity.sha256 : ""}"`}});
    Object.defineProperty(response, "url", {value: object.source.url}); return response;
  });
  vi.stubGlobal("fetch", fetcher); return {object, pool, store, materializer, fetcher};
}
afterEach(async () => {
  for (const owner of owners.splice(0)) {
    owner.materializer.close(); owner.store.close(); owner.pool.close(); await Promise.resolve();
    expect(owner.pool.stats).toMatchObject({active: 0, queued: 0, pending: 0, waiters: 0, temporaryBytes: 0, outputBytes: 0});
    expect(owner.materializer.stats).toMatchObject({active: 0, queued: 0});
  }
  vi.unstubAllGlobals();
});
it("[ST-11] UNIT/whole [IO-21] UNIT/materialize one full GET verifies and hands off independent bytes", async () => {
  const bytes = Uint8Array.from({length: 786449}, (_, i) => i % 251), {materializer, object, fetcher, store} = setup(bytes);
  const result = await materializer.prepare(object, {kind: "BYTES", maxBytes: bytes.length});
  expect(result.kind).toBe("BYTES"); if (result.kind !== "BYTES") {throw new Error("bad kind");}
  expect(result.bytes).toEqual(bytes); expect(result.receipt.localSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(fetcher).toHaveBeenCalledTimes(1); expect(store.stats.networkBytes).toBe(bytes.length);
  expect(materializer.stats).toMatchObject({materializedBytes: bytes.length, materializedBytesByKind: {BYTES: bytes.length, BLOB: 0, SINK: 0}, wholeRestartCount: 0});
  expect((fetcher.mock.calls as unknown[][])[0][1]).toMatchObject({headers: {}});
});
it("[IO-20] UNIT/materialize [X-01] UNIT/materialize equal-length wrong body never commits or escapes", async () => {
  const {materializer, object} = setup(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]));
  const sink = {write: vi.fn(async () => {}), commit: vi.fn(async () => {}), abort: vi.fn(async () => {})};
  await expect(materializer.prepare(object, {kind: "SINK", maxBytes: 3, createSink: async () => sink})).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(sink.commit).not.toHaveBeenCalled(); expect(sink.abort).toHaveBeenCalledExactlyOnceWith("FAILED"); expect(object.state.revoked).toBe(true);
});
it("[X-26] UNIT/commit [HP-02] UNIT/progress does not publish 100% until the sink has committed", async () => {
  const {materializer, object} = setup(new Uint8Array([1, 2, 3])); let commit!: () => void;
  const reached = deferred(), barrier = deferred();
  const sink: MaterializeSinkV1 = {write: async () => {}, commit: async () => {commit = () => barrier.resolve(); reached.resolve(); await barrier.promise;}, abort: async () => {}};
  const report = vi.fn(), pending = materializer.prepare(object, {kind: "SINK", maxBytes: 3, createSink: async () => sink}, undefined, report);
  await reached.promise; expect(report.mock.calls.map(([progress]) => progress.readyBytes)).toEqual([0]);
  commit(); await pending; expect(report.mock.calls.map(([progress]) => progress.readyBytes)).toEqual([0, 3]);
});
it("[X-26] UNIT/empty valid empty BYTES and BLOB retain their type and digest without HTTP", async () => {
  const {materializer, object, fetcher} = setup(new Uint8Array());
  const bytes = await materializer.prepare(object, {kind: "BYTES", maxBytes: 0});
  const blob = await materializer.prepare(object, {kind: "BLOB", maxBytes: 0});
  expect(bytes.kind).toBe("BYTES"); expect(blob.kind).toBe("BLOB");
  if (bytes.kind === "BYTES") {expect(bytes.bytes).toBeInstanceOf(Uint8Array); expect(bytes.bytes.length).toBe(0);}
  if (blob.kind === "BLOB") {expect(blob.blob).toBeInstanceOf(Blob); expect(blob.blob.size).toBe(0); await blob.release();}
  expect(fetcher).not.toHaveBeenCalled(); expect(bytes.receipt.localSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
it("[X-11] UNIT/queue cancelling a queued prepare leaves the active sink untouched", async () => {
  const {materializer, object, fetcher} = setup(new Uint8Array([1, 2, 3])), controller = new AbortController();
  const reached = deferred(), barrier = deferred(), abort = vi.fn(async () => {});
  const first = materializer.prepare(object, {kind: "SINK", maxBytes: 3, createSink: async () => ({write: async () => {reached.resolve(); await barrier.promise;}, commit: async () => {}, abort})});
  await reached.promise;
  const factory = vi.fn(async () => ({write: async () => {}, commit: async () => {}, abort}));
  const queued = materializer.prepare(object, {kind: "SINK", maxBytes: 3, createSink: factory}, controller.signal);
  const rejected = expect(queued).rejects.toThrow("ABORTED"); controller.abort(); await rejected;
  barrier.resolve(); await first; expect(factory).not.toHaveBeenCalled(); expect(abort).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["write", "commit"] as const)("[X-12] UNIT/sink-%s sink failure has one abort and no completed progress", async (operation) => {
  const {materializer, object} = setup(new Uint8Array([1, 2, 3])), report = vi.fn();
  const sink = {write: vi.fn(async () => {}), commit: vi.fn(async () => {}), abort: vi.fn(async () => {})};
  sink[operation].mockRejectedValue(new Error("disk failed"));
  await expect(materializer.prepare(object, {kind: "SINK", maxBytes: 3, createSink: async () => sink}, undefined, report)).rejects.toThrow("WORKSPACE_UNAVAILABLE");
  expect(sink.abort).toHaveBeenCalledExactlyOnceWith("FAILED"); expect(report.mock.calls.some(([progress]) => progress.committed)).toBe(false);
});
it("[ST-14] UNIT/restart waits for acknowledgement before a single whole restart", async () => {
  const bytes=new Uint8Array([1,2,3]), {materializer,object,store,fetcher}=setup(bytes);
  vi.spyOn(store,"persistent").mockReturnValue({resources:{metadata:{generation:async()=>({state:"STAGING",committedBytes:1})}}} as never);
  vi.spyOn(store,"local").mockResolvedValue(null);
  const first={write:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),abort:vi.fn(async()=>{})};
  const second={write:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),abort:vi.fn(async()=>{})};
  const factory=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second), barrier=deferred(), reached=deferred();
  const restart=vi.fn(async()=>{reached.resolve();await barrier.promise;});
  const pending=materializer.prepare(object,{kind:"SINK",maxBytes:3,createSink:factory},undefined,()=>{},restart);
  const outcome=pending.then(result=>({result}),error=>({error}));
  await Promise.race([reached.promise,outcome]);
  expect(restart).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
  expect(first.abort).toHaveBeenCalledWith("RESTART"); expect(materializer.stats.wholeRestartCount).toBe(0); barrier.resolve();
  expect(await outcome).toHaveProperty("result.kind","SINK");expect(fetcher).toHaveBeenCalledTimes(2);expect(second.commit).toHaveBeenCalledTimes(1); expect(materializer.stats.wholeRestartCount).toBe(1);
});

it("[X-22] UNIT/materialize-credit-failure disposes abort listeners after a rejected buffer reservation", async () => {
  const {materializer, object, pool} = setup(new Uint8Array([1, 2, 3]));
  const combine = abort.combineSignals, disposers: ReturnType<typeof vi.fn>[] = [];
  const spy = vi.spyOn(abort, "combineSignals").mockImplementation(signals => {
    const scope = combine(signals), dispose = vi.fn(scope.dispose); disposers.push(dispose); return {...scope, dispose};
  });
  try {
    vi.spyOn(pool.credits, "reserve").mockRejectedValueOnce(new ContentIOError("ABORTED"));
    await expect(materializer.prepare(object, {kind: "BYTES", maxBytes: 3})).rejects.toThrow("ABORTED");
    expect(disposers.length).toBeGreaterThanOrEqual(2);
    for (const dispose of disposers) {expect(dispose).toHaveBeenCalledOnce();}
  } finally {spy.mockRestore();}
});

it("[X-22] UNIT/stream-credit-failure disposes the acknowledgement deadline when reserving output fails", async () => {
  const {object, pool, store} = setup(new Uint8Array([1, 2, 3]));
  const reserve = pool.credits.reserve.bind(pool.credits);
  vi.spyOn(pool.credits, "reserve").mockImplementation((bytes, kind, signal) => kind === "OUTPUT" ? Promise.reject(new ContentIOError("CAPACITY_EXCEEDED")) : reserve(bytes, kind, signal));
  const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
  let complete!: () => void; const done = new Promise<void>(resolve => {complete = resolve;});
  const send = vi.fn((message: ContentMessageV1) => {if (message.type === "ERROR") {complete();}});
  const jobs = new ManagementJobs(pool, store, address, send, vi.fn());
  vi.useFakeTimers();
  try {
    jobs.start({...base(address, 1), type: "PREPARE", fileId: crypto.randomUUID(), jobId: crypto.randomUUID(), result: "STREAM", maxBytes: 3},
      {object, policy: {mode: "EAGER", bridge: "NONE", result: "WORKSPACE_FILE", maxFileBytes: 3, workspace: "OPFS_REQUIRED", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"}});
    await done; expect(jobs.stats.jobs).toBe(0); expect(vi.getTimerCount()).toBe(0);
    expect(send.mock.calls.some(([message]) => message.type === "JOB_CHUNK" || message.type === "PREPARE_OK")).toBe(false);
  } finally {jobs.close(); vi.useRealTimers();}
});
