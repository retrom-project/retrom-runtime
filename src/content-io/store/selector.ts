import {abortable, requestScope} from "../abort.js";
import {ContentLocks} from "./locks.js";
import {ContentMetadata} from "./metadata.js";
import {OPFSStore} from "./opfs.js";
import {CacheBlockStore} from "./cache-storage.js";
import type {Backend, DataStore} from "./types.js";
export type PersistentResources = {metadata: ContentMetadata; locks: ContentLocks; data: DataStore};
/** READY is independent of this optional probe; selection freezes on first access. */
export class StoreSelector {
  private readonly controller = new AbortController();
  private readonly probing: Promise<PersistentResources | null>;
  private selected: Promise<PersistentResources | null> | undefined;
  private resources: PersistentResources | undefined;
  private stopped = false;
  private fallback: Promise<PersistentResources | null> | undefined;
  private readonly stores: DataStore[] = [];
  private readonly readers = new Map<Backend, Promise<PersistentResources | undefined>>();
  constructor(private readonly origin: string, private readonly ready: (backend: string) => void = () => {}) {
    this.probing = this.probe();
    void this.probing.then((resources) => {if (resources && !this.stopped) {this.ready(resources.data.backend);}});
  }
  select(): Promise<PersistentResources | null> {
    if (!this.selected) {
      this.selected = (async () => {
        const scope = requestScope(this.controller.signal, 500);
        try {return await abortable(this.probing, scope.signal);}
        catch {this.stopped = true; this.controller.abort(); return null;}
        finally {scope.dispose();}
      })();
    }
    return this.selected;
  }
  get availableStores():readonly DataStore[]{return this.stores;}
  readable(backend: Backend): Promise<PersistentResources | undefined> {
    let pending = this.readers.get(backend);
    if (!pending) {
      pending = this.openReadable(backend); this.readers.set(backend, pending);
    }
    return pending;
  }
  private async openReadable(backend: Backend): Promise<PersistentResources | undefined> {
    const resources = this.resources;
    if (!resources || this.stopped) {return undefined;}
    let data = this.stores.find(store => store.backend === backend);
    if (!data && backend === "CACHE_BLOCKS") {
      try {
        data = await this.bounded(() => CacheBlockStore.open(this.origin));
        if (this.stopped) {return undefined;}
        this.stores.push(data);
      } catch {return undefined;}
    }
    return data ? {...resources, data} : undefined;
  }
  degrade():Promise<PersistentResources|null>{
    if(this.fallback){return this.fallback;}
    const previous=this.select();
    this.fallback=(async()=>{
      const current=await previous;
      if(!current || current.data.backend!=="OPFS"){return null;}
      try{
        const data=await this.bounded(async()=>{const store=await CacheBlockStore.open(this.origin);await store.probe();return store;});
        if(this.stopped){return null;}
        const next={...current,data};this.stores.push(data);this.resources=next;this.ready(data.backend);return next;
      }catch{return null;}
    })();
    const pending=this.fallback;void pending.then(resources=>{if(!resources && !this.stopped){this.ready("MEMORY");}}).finally(()=>{this.fallback=undefined;});
    this.selected=pending;return pending;
  }
  close(): void {this.stopped = true; this.controller.abort(); this.resources?.metadata.close();}
  private async bounded<Value>(action: () => Promise<Value>, late?: (value: Value) => void): Promise<Value> {
    const scope = requestScope(this.controller.signal, 2000), pending = action();
    void pending.then((value) => {if (scope.signal.aborted) {late?.(value);}}, () => {});
    try {return await abortable(pending, scope.signal);} finally {scope.dispose();}
  }
  private async probe(): Promise<PersistentResources | null> {
    let metadata: ContentMetadata | undefined;
    try {
      if (!globalThis.indexedDB || !globalThis.navigator?.locks) {return null;}
      metadata = await this.bounded(() => ContentMetadata.open(), (db) => db.close());
      await this.bounded(() => metadata!.transaction<boolean>(["jobs"], "readwrite", (tx, finish) => {
        const store = tx.objectStore("jobs"), jobId = crypto.randomUUID(); store.put({jobId, objectKey: "probe"});
        const read = store.get(jobId); read.onsuccess = () => {if (read.result?.jobId !== jobId) {tx.abort(); return;} store.delete(jobId); finish(true);};
      }));
      const locks = new ContentLocks(); await locks.probe(this.controller.signal);
      let data: DataStore;
      try {data = await this.bounded(async () => {const store = await OPFSStore.open(); await store.probe(); return store;});}
      catch {data = await this.bounded(async () => {const store = await CacheBlockStore.open(this.origin); await store.probe(); return store;});}
      if (this.stopped) {metadata.close(); return null;}
      this.stores.push(data);this.resources = {metadata, locks, data}; return this.resources;
    } catch {metadata?.close(); return null;}
  }
}
