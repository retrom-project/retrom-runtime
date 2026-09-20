import type {ContentDiagnosticCountsV1, ContentMessageV1} from "../../contracts/content-io/v1/content-io.js";
import type {BlockPool} from "./block-pool.js";
import type {ContentStoreManager} from "./store/manager.js";
import type {ManagementJobs} from "./management-jobs.js";
import {readSyncMetrics, type SyncMetrics} from "./sync-metrics.js";
export type ContentDiagnostic = Pick<Extract<ContentMessageV1, {type: "DIAGNOSTIC"}>, "sessionId" | "operation" | "codeNumber" | "counts">;
const emptySync = (): SyncMetrics => ({memoryHitBytes: 0, persistentHitBytes: 0, cacheBytesL1: 0, peakCacheBytesL1: 0});
/** Allocation owners supply peaks; periodic delivery is not used to estimate them. */
export class SessionDiagnostics {
  private readonly sync = new Map<string, {buffer: SharedArrayBuffer; last: SyncMetrics; closed: boolean}>();
  private readonly retired = emptySync();
  private peakChannels = 0;
  private peakSyncBufferBytes = 0;
  channel(id: string, buffer: SharedArrayBuffer | null, channels: number): void {
    if (buffer) {this.sync.set(id, {buffer, last: emptySync(), closed: false});}
    this.peakChannels = Math.max(this.peakChannels, channels);
    this.peakSyncBufferBytes = Math.max(this.peakSyncBufferBytes, [...this.sync.values()].reduce((sum, value) => sum + value.buffer.byteLength, 0));
  }
  release(id: string): void {
    const value = this.sync.get(id); if (!value) {return;}
    value.closed = true; this.collectClosed();
  }
  private collectClosed(): void {
    for (const [id, value] of this.sync) {
      if (!value.closed) {continue;}
      const last = readSyncMetrics(new Int32Array(value.buffer, 0, 16));
      // Retain the accounting view until consumer cleanup is actually observable.
      // A killed consumer with an incomplete update must not be reported as zero.
      if (!last || last.cacheBytesL1 !== 0) {continue;}
      this.retired.memoryHitBytes += last.memoryHitBytes; this.retired.persistentHitBytes += last.persistentHitBytes;
      this.retired.peakCacheBytesL1 = Math.max(this.retired.peakCacheBytesL1, last.peakCacheBytesL1);
      this.sync.delete(id);
    }
  }

  counts(pool: BlockPool, store: ContentStoreManager, jobs: ManagementJobs, channels: number): ContentDiagnosticCountsV1 {
    this.collectClosed();
    const sync = {...this.retired}; let syncBufferBytes = 0;
    for (const value of this.sync.values()) {
      value.last = readSyncMetrics(new Int32Array(value.buffer, 0, 16)) ?? value.last;
      sync.memoryHitBytes += value.last.memoryHitBytes; sync.persistentHitBytes += value.last.persistentHitBytes;
      sync.cacheBytesL1 += value.last.cacheBytesL1; sync.peakCacheBytesL1 = Math.max(sync.peakCacheBytesL1, value.last.peakCacheBytesL1);
      syncBufferBytes += value.buffer.byteLength;
    }
    const current = pool.stats, peak = pool.peaks, storage = store.stats, material = jobs.stats;
    return {...sync, syncBufferBytes, networkBytes: storage.networkBytes, rangeRequests: storage.rangeRequests,
      wholeRequests: storage.wholeRequests, headRequests: storage.headRequests, retries: storage.retries,
      cacheDegrades: storage.cacheDegrades, corruptBlocks: storage.corruptBlocks, leases: storage.leases, peakLeases: storage.peakLeases,
      memoryHitBytes: sync.memoryHitBytes + material.memoryHitBytes, persistentHitBytes: sync.persistentHitBytes + material.persistentHitBytes,
      readyBytes: material.readyBytes, materializedBytes: material.materializedBytes, wholeRestartCount: material.wholeRestartCount,
      materializedBytesByBytes: material.materializedBytesByKind.BYTES, materializedBytesByBlob: material.materializedBytesByKind.BLOB,
      materializedBytesBySink: material.materializedBytesByKind.SINK, cacheBytesL2: current.lruBytes, temporaryBytes: current.temporaryBytes,
      outputCreditBytes: current.outputBytes, inflight: current.active, queued: current.queued, waiters: current.waiters, channels,
      peakCacheBytesL2: peak.lruBytes, peakTemporaryBytes: peak.temporaryBytes, peakOutputCreditBytes: peak.outputBytes,
      peakInflight: peak.active, peakQueued: peak.queued, peakWaiters: peak.waiters, peakChannels: this.peakChannels,
      peakSyncBufferBytes: this.peakSyncBufferBytes};
  }
}
