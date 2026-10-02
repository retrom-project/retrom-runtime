import {ContentLocks} from "./locks.js";
import {ContentMetadata} from "./metadata.js";
import type {DataStore} from "./types.js";
/** Only the new raw namespace. Workspace projects and save directories are never visited. */
export class ContentGC {
  private running: Promise<number> | undefined;
  constructor(private readonly metadata: ContentMetadata, private readonly locks: ContentLocks, private readonly stores: readonly DataStore[]) {}
  collect(): Promise<number> {
    if (!this.running) {this.running = this.run().finally(() => {this.running = undefined;});} return this.running;
  }
  private async run(): Promise<number> {
    const candidates = await this.metadata.list(128, "QUARANTINED");
    let removed = 0;
    candidates.sort((a, b) => Number(b.state === "QUARANTINED") - Number(a.state === "QUARANTINED") || a.lastAccessMs - b.lastAccessMs);
    for (const candidate of candidates) {
      if (removed >= 64) {break;}
      // Verified complete files and committed partial blocks survive age and quota pressure.
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
