import {ReadAccounting, type ReadOrigin} from "./read-accounting.js";
import {createRequiredSink,sinkOperation} from "./sink-operations.js";
import type {MaterializationReceiptV1, MaterializeRequestV1, MaterializeResultV1, MaterializeSinkV1} from "../../contracts/content-io/v1/content-io.js";
import {PersistentBlobSink, BlobReplayRequired} from "./blob-sink.js";
import {checkSignal, combineSignals} from "./abort.js";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {createContentHasher} from "./bounded-stream.js";
import {ContentIOError, fail} from "./errors.js";
import {SerialGate} from "./gate.js";
import {fetchWholeStream} from "./http.js";
import {ContentProgress, type PreparationProgress} from "./progress.js";
import {BlobSink, BytesSink, type ResultSink} from "./sinks.js";
import {BLOCK_BYTES, integer} from "./source.js";
import {ContentStoreManager} from "./store/manager.js";
import {completeBacking} from "./store/complete.js";
export class ContentMaterializer {
  private readonly gate = new SerialGate();
  private readonly controller = new AbortController();
  private materializedBytes = 0;
  private readyBytes = 0;
  private readonly accounting = new ReadAccounting();
  private wholeRestartCount = 0;
  private readonly materializedBytesByKind = {BYTES: 0, BLOB: 0, SINK: 0};
  constructor(private readonly pool: BlockPool, private readonly store: ContentStoreManager) {}
  get stats() {return {...this.gate.stats, ...this.accounting.counts, readyBytes: this.readyBytes, materializedBytes: this.materializedBytes, materializedBytesByKind: {...this.materializedBytesByKind}, wholeRestartCount: this.wholeRestartCount};}
  close(): void {this.controller.abort();}
  async prepare(object: BlockObject, request: MaterializeRequestV1, signal?: AbortSignal,
    report: (progress: PreparationProgress) => void = () => {}, restart: () => Promise<void> = async () => {}): Promise<MaterializeResultV1> {
    this.pool.check(object); checkSignal(signal);
    if (!integer(request.maxBytes) || object.source.sizeBytes > request.maxBytes) {fail("BOUNDS");}
    const combined = combineSignals([this.controller.signal, ...(signal ? [signal] : [])]);
    let release: (() => void) | undefined;
    try {
      release = await this.gate.acquire(combined.signal);
      await this.store.prepare(object, combined.signal); this.pool.check(object); checkSignal(combined.signal);
      const progress = new ContentProgress(object.source.sizeBytes, () => this.store.stats.networkBytes, progress => {this.readyBytes = progress.readyBytes; report(progress);});
      progress.start();
      try {
        try {return await this.run(object, request, combined.signal, progress);}
        catch (error) {
          if (!(error instanceof BlobReplayRequired) || request.kind !== "BLOB") {throw error;}
          return await this.run(object, request, combined.signal, progress, "BLOCKS");
        }
      } catch (error) {
        if (!this.canRestart(object,error)) {throw error;}
        await restart(); checkSignal(combined.signal); this.wholeRestartCount++; progress.restart();
        return await this.run(object, request, combined.signal, progress, "WHOLE");
      }
    } finally {release?.(); combined.dispose();}
  }
  private async run(object: BlockObject, request: MaterializeRequestV1, signal: AbortSignal, progress: ContentProgress, recovery?: "BLOCKS" | "WHOLE"): Promise<MaterializeResultV1> {
    const size = object.source.sizeBytes, sink = await this.sink(object,request,signal,!!recovery);
    const hash = createContentHasher(); let written = 0;
    const consume = async (chunk: Uint8Array<ArrayBuffer>) => {
      this.pool.check(object); checkSignal(signal); hash.update(chunk);
      try {await (request.kind === "SINK" ? sinkOperation(()=>sink.write(written,chunk),signal) : sink.write(written,chunk));} catch (cause) {checkSignal(signal);if(request.kind!=="SINK"){throw cause;}throw new ContentIOError("WORKSPACE_UNAVAILABLE", {cause});}
      written += chunk.length; progress.position(written);
    };
    try {
      if (recovery === "BLOCKS") {await this.blocks(object,signal,consume);}
      else {await this.acquire(object, signal, consume, recovery === "WHOLE");}
      this.pool.check(object); checkSignal(signal);
      const digest = hash.digest();
      if (written !== size) {fail("LENGTH_MISMATCH");}
      if (object.source.identity.kind === "FILE_SHA256" && digest !== object.source.identity.sha256) {fail("CHECKSUM_MISMATCH");}
      const receipt: MaterializationReceiptV1 = {objectKey: object.key, storageGeneration: this.store.persistent(object)?.generation ?? object.state.generation,
        sizeBytes: size, localSha256: digest, assurance: object.source.identity.kind === "FILE_SHA256" ? "EXPECTED_SHA256" : "TRUSTED_IMMUTABLE_INDEX", pinnedEtag: object.state.pinnedEtag};
      await this.commitBacking(object, receipt, signal);
      try {await (request.kind === "SINK" ? sinkOperation(()=>sink.commit(receipt),signal,20000) : sink.commit(receipt));} catch (cause) {checkSignal(signal);if(request.kind!=="SINK"){throw cause;}throw new ContentIOError("WORKSPACE_UNAVAILABLE", {cause});}
      checkSignal(signal); const result = this.result(request, sink, receipt);
      this.materializedBytes += size; this.materializedBytesByKind[result.kind] += size; progress.complete(); return result;
    } catch (error) {
      await sinkOperation(()=>sink.abort(signal.aborted ? "CANCELLED" : this.canRestart(object,error) ? "RESTART" : "FAILED"),new AbortController().signal).catch(() => {});
      if (error instanceof ContentIOError && error.scope === "OBJECT") {object.state.revoked = true; this.pool.cache.deletePrefix(`${object.key}:`);}
      throw error;
    } finally {hash.destroy();}
  }
  private async sink(object: BlockObject, request: MaterializeRequestV1, signal: AbortSignal, recovery: boolean): Promise<MaterializeSinkV1> {
    if(request.kind === "SINK"){return await createRequiredSink(request.createSink,signal);}
    const size=object.source.sizeBytes, backing=this.store.persistent(object);
    if(request.kind === "BYTES"){return new BytesSink(size);}
    return !recovery && backing?.resources.data.file && size>0 ? new PersistentBlobSink(object,backing,this.store,this.pool.credits,signal) : new BlobSink(size);
  }
  private canRestart(object: BlockObject, error: unknown): boolean {
    return object.source.transport === "WHOLE_ALLOWED" && error instanceof ContentIOError && error.code === "CONTENT_IO_RANGE_UNSUPPORTED";
  }
  private async acquire(object: BlockObject, signal: AbortSignal, consume: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>, forceWhole = false): Promise<void> {
    if (object.source.sizeBytes === 0) {return;}
    const backing = this.store.persistent(object);
    const current = backing ? await backing.resources.metadata.generation(backing.key, backing.generation) : undefined;
    const reusable = current?.state === "COMPLETE" || object.source.etagPolicy !== "NONE_FULL_SHA256" && (current?.committedBytes ?? 0) > 0;
    if (object.source.transport === "WHOLE_ALLOWED" && (forceWhole || !reusable)) {
      await this.pool.scheduler.consume(`whole:${object.key}:${object.state.generation}`, async (active) => {
        const combined = combineSignals([signal, active]); let release: (() => void) | undefined;
        try {
          release = await this.pool.credits.reserve(2 * BLOCK_BYTES, "SCRATCH", combined.signal);
          let index = 0;
          for await (const bytes of fetchWholeStream(object.source, object.state, combined.signal, this.store.httpTelemetry)) {
            await this.store.stage(object, index++, bytes, combined.signal); await consume(bytes);
          }
          return {bytes: new Uint8Array(0), release: () => {}};
        } finally {release?.(); combined.dispose();}
      }, () => {}, {signal, priority: "MATERIALIZE", whole: true});
      return;
    }
    await this.blocks(object, signal, consume);
  }
  private async blocks(object: BlockObject, signal: AbortSignal, consume: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>) {
    for (let offset = 0; offset < object.source.sizeBytes; offset += BLOCK_BYTES) {
      const count = Math.min(BLOCK_BYTES, object.source.sizeBytes - offset), release = await this.pool.credits.reserve(2 * BLOCK_BYTES, "SCRATCH", signal);
      try {
        const cached = await this.store.local(object, offset / BLOCK_BYTES, signal, true);
        if (cached) {await consume(cached); this.accounting.copied("PERSISTENT", cached.length); continue;}
        const bytes = new Uint8Array(count); let origin: ReadOrigin = "NETWORK";
        await this.pool.copy(object, offset / BLOCK_BYTES, 0, bytes, () => this.pool.check(object), {signal, priority: "MATERIALIZE", copied: value => {origin = value;}});
        await consume(bytes); this.accounting.copied(origin, bytes.length);
      } finally {release();}
    }
  }
  private async commitBacking(object: BlockObject, receipt: MaterializationReceiptV1, signal: AbortSignal): Promise<void> {
    const backing = this.store.persistent(object); if (!backing) {return;}
    try {await completeBacking(backing, receipt, this.pool.credits, signal);} catch (error) {
      checkSignal(signal); if (error instanceof ContentIOError && error.scope === "OBJECT") {throw error;}
    }
  }
  private result(request: MaterializeRequestV1, sink: MaterializeSinkV1, receipt: MaterializationReceiptV1): MaterializeResultV1 {
    if (request.kind === "SINK") {return {kind: "SINK", receipt};}
    const result = (sink as ResultSink).result();
    if (request.kind === "BYTES") {return {kind: "BYTES", bytes: result as Uint8Array, receipt};}
    return {kind: "BLOB", blob: result as Blob, receipt, release: sink instanceof PersistentBlobSink ? () => sink.release() : async () => {}};
  }
}
