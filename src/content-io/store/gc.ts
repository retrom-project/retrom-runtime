import {ContentLocks} from "./locks.js";
import {ContentMetadata} from "./metadata.js";
import type {DataStore} from "./types.js";
/** Only the new raw namespace. Workspace projects and save directories are never visited. */
export class ContentGC {
  private running: Promise<number> | undefined;
  constructor(private readonly metadata: ContentMetadata, private readonly locks: ContentLocks, private readonly stores: readonly DataStore[]) {}
  collect(budgetBytes?: number): Promise<number> {
    if (!this.running) {this.running = this.run(budgetBytes).finally(() => {this.running = undefined;});} return this.running;
  }
  private async run(budgetBytes?: number): Promise<number> {
    const estimate = await navigator.storage.estimate().catch(() => ({} as StorageEstimate));
    const budget = budgetBytes ?? (estimate.quota === undefined ? 512 * 1024 * 1024 : Math.min(8 * 1024 ** 3, Math.floor(estimate.quota * 0.2)));
    const candidates = await this.metadata.list(128);
    let remaining = await this.metadata.totalBytes(), removed = 0;
    const now = Date.now();
    candidates.sort((a, b) => Number(b.state === "QUARANTINED") - Number(a.state === "QUARANTINED") || a.lastAccessMs - b.lastAccessMs);
    for (const candidate of candidates) {
      if (removed >= 64) {break;}
      const obsolete = candidate.state === "QUARANTINED" || candidate.state !== "COMPLETE" && now - candidate.lastAccessMs > 24 * 60 * 60 * 1000;
      if (!obsolete && remaining <= budget) {continue;}
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
      if (bytes !== undefined && bytes > 0) {remaining -= bytes; removed++;}
    }
    return removed;
  }
}
