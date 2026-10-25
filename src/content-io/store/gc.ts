import {ContentLocks} from "./locks.js";
import {ContentMetadata} from "./metadata.js";
import {checkSignal, requestScope} from "../abort.js";
import {fail} from "../errors.js";
import {validLocation} from "./opfs.js";
import type {ContentCacheReclaimRequestV1, ContentCacheReclaimResultV1} from "../../provider/generated/provider-module-v1.js";
import type {DataStore, GenerationRecord, ObjectRecord} from "./types.js";
export type ReclaimRequest = ContentCacheReclaimRequestV1;
export type ReclaimResult = ContentCacheReclaimResultV1;
const candidateLimit = 512, objectLimit = 64, generationLimit = 128, jobLimit = 128;
/** Only the new raw namespace. Workspace projects and save directories are never visited. */
export class ContentGC {
  private running: Promise<number> | undefined;
  constructor(private readonly metadata: ContentMetadata, private readonly locks: ContentLocks, private readonly stores: readonly DataStore[]) {}
  collect(): Promise<number>;
  collect(request: ReclaimRequest): Promise<ReclaimResult>;
  collect(request?: ReclaimRequest): Promise<number | ReclaimResult>;
  collect(request?: ReclaimRequest): Promise<number | ReclaimResult> {
    if (request) {return this.pressure(request);}
    if (!this.running) {this.running = this.run().finally(() => {this.running = undefined;});} return this.running;
  }
  private async pressure(request: ReclaimRequest): Promise<ReclaimResult> {
    if (!Number.isSafeInteger(request.targetBytes) || request.targetBytes <= 0) {fail("SOURCE_INVALID");}
    const scope = requestScope(request.signal, 5000);
    const result = {reclaimedBytes: 0, removedObjects: 0};
    try {
      const candidates = await this.metadata.list(candidateLimit);
      checkSignal(scope.signal);
      for (const candidate of candidates.slice(0, candidateLimit)) {
        if (result.reclaimedBytes >= request.targetBytes || result.removedObjects >= objectLimit) {break;}
        checkSignal(scope.signal);
        const bytes = await this.locks.gc(candidate.key, () => this.locks.data(candidate.key, scope.signal,
          () => this.removeIdle(candidate, scope.signal)), scope.signal);
        // A native deletion is not abortable. Keep its lock until metadata also settles.
        checkSignal(scope.signal);
        if (bytes !== undefined && bytes !== null) {
          result.reclaimedBytes += bytes; result.removedObjects++;
          if (!Number.isSafeInteger(result.reclaimedBytes)) {fail("CACHE_UNAVAILABLE");}
        }
      }
      return result;
    } finally {scope.dispose();}
  }
  private async removeIdle(candidate: ObjectRecord, signal: AbortSignal): Promise<number | null> {
    checkSignal(signal);
    const current = await this.metadata.object(candidate.key);
    if (!current || current.revision !== candidate.revision || current.generation !== candidate.generation ||
      current.lastAccessMs !== candidate.lastAccessMs) {return null;}
    const generations = await this.metadata.generations(candidate.key, generationLimit + 1);
    const jobs = await this.metadata.jobs(candidate.key, jobLimit + 1);
    checkSignal(signal);
    if (generations.length > generationLimit || jobs.length > jobLimit || jobs.some(job => job.state === "ACTIVE")) {return null;}
    if (generations.some(generation => !this.stores.some(store => store.backend === generation.backend))) {return null;}
    const bytes = reclaimBytes(current, generations);
    // All completion attestations must be revoked before any physical backend can be removed.
    // Existing PARTIAL generations need no write, including when quota is already exhausted.
    for (const generation of generations) {
      if (generation.state !== "COMPLETE") {continue;}
      await this.metadata.update(current.key, generation.generation, generation.revision, record => {
        record.state = "PARTIAL"; record.completionAssurance = null; record.localSha256 = null;
      });
      checkSignal(signal);
    }
    checkSignal(signal);
    // Once physical removal begins, finish this whole object even after cancellation/deadline.
    for (const store of this.stores) {
      await store.remove(current.key, generations.filter(generation => generation.backend === store.backend).map(generation => generation.generation));
    }
    await this.metadata.remove(current.key);
    return bytes;
  }
  private async run(): Promise<number> {
    const candidates = await this.metadata.list(128, "QUARANTINED");
    let removed = 0;
    candidates.sort((a, b) => Number(b.state === "QUARANTINED") - Number(a.state === "QUARANTINED") || a.lastAccessMs - b.lastAccessMs);
    for (const candidate of candidates) {
      if (removed >= 64) {break;}
      // Routine collection retains valid content; pressure recovery is an explicit call.
      if (candidate.state !== "QUARANTINED") {continue;}
      const bytes = await this.locks.gc(candidate.key, () => this.locks.data(candidate.key, undefined, async () => {
        const current = await this.metadata.object(candidate.key);
        if (!current || current.revision !== candidate.revision) {return 0;}
        const generations = await this.metadata.generations(candidate.key);
        // Do not orphan a backend whose storage API is unavailable in this Session.
        if (generations.some((generation) => !this.stores.some((store) => store.backend === generation.backend))) {return 0;}
        for (const store of this.stores) {await store.remove(candidate.key, generations.filter((generation) => generation.backend === store.backend).map((generation) => generation.generation));}
        await this.metadata.remove(candidate.key);
        return generations.reduce((sum, generation) => sum + generation.committedBytes, 0);
      }));
      if (bytes !== undefined && bytes > 0) {removed++;}
    }
    return removed;
  }
}
function reclaimBytes(object: ObjectRecord, generations: GenerationRecord[]): number {
  if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 0) {fail("CACHE_UNAVAILABLE");}
  let bytes = 0;
  for (const generation of generations) {
    validLocation(object.key, generation.generation);
    if (generation.objectKey !== object.key || !Number.isSafeInteger(generation.committedBytes) || generation.committedBytes < 0) {
      fail("CACHE_UNAVAILABLE");
    }
    // Receipted logical bytes are not a promise about browser physical quota accounting.
    bytes += Math.min(object.sizeBytes, generation.committedBytes);
    if (!Number.isSafeInteger(bytes)) {fail("CACHE_UNAVAILABLE");}
  }
  return bytes;
}
