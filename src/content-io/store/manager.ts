import {abortable, checkSignal, combineSignals, requestScope} from "../abort.js";
import type {BlockObject} from "../block-pool.js";
import {BufferCredits} from "../credits.js";
import {ContentIOError} from "../errors.js";
import {fetchRangeBlock, type HttpDependencies} from "../http.js";
import {PersistentBacking} from "./backing.js";
import type {BlockReceipt} from "./types.js";
import {ContentGC} from "./gc.js";
import {StoreSelector, type PersistentResources} from "./selector.js";
type CacheOperation = "CACHE_PROBE" | "CACHE_READ" | "CACHE_WRITE";
type Binding = {backing: PersistentBacking; release: () => void};
export class ContentStoreManager {
  private readonly selector: StoreSelector;
  private readonly controller = new AbortController();
  private readonly preparing = new Map<string, Promise<Binding | null>>();
  private readonly bindings = new Map<string, Binding>();
  private readonly writes = new Set<Promise<void>>();
  private readonly useLeases = new Set<() => void>();
  private peakLeases = 0;
  private degraded = false;
  private readonly failedBackends=new Set<string>();
  private readonly retired=new Map<string,Binding[]>();
  private epoch=0;
  private switched=false;
  private addedBytes=0;
  private readonly collectors=new Map<PersistentResources,ContentGC>();
  private corruptBlocks = 0;
  private networkBytes = 0;
  private cacheBytes = 0;
  private rangeRequests = 0;
  private wholeRequests = 0;
  private retries = 0;
  readonly httpTelemetry: Pick<HttpDependencies, "consumed" | "dispatched"> = {
    consumed: (bytes) => this.countNetwork(bytes),
    dispatched: (kind, retry) => {
      if (kind === "RANGE") {this.rangeRequests++;} else {this.wholeRequests++;}
      if (retry) {this.retries++;}
    },
  };
  constructor(origin: string, private readonly credits: BufferCredits, backendReady: (backend: string) => void = () => {},
    private readonly diagnostic: (error: ContentIOError, operation: CacheOperation) => void = () => {}) {
    this.selector = new StoreSelector(origin, backendReady);
  }
  get stats() {return {leases: this.useLeases.size, peakLeases: this.peakLeases, optionalWrites: this.writes.size, degraded: this.degraded, networkBytes: this.networkBytes, cacheBytes: this.cacheBytes, rangeRequests: this.rangeRequests, wholeRequests: this.wholeRequests, headRequests: 0, retries: this.retries, cacheDegrades: this.failedBackends.size, corruptBlocks: this.corruptBlocks};}
  async prepare(object: BlockObject, signal?: AbortSignal): Promise<void> {
    checkSignal(this.controller.signal); checkSignal(signal);
    let pending = this.preparing.get(object.key);
    if (!pending) {pending = this.attach(object); this.preparing.set(object.key, pending);}
    const binding = await abortable(pending, signal);
    if (binding) {
      // Network identity belongs to the Session object, not an optional physical cache generation.
      // Rebinding storage must not invalidate concurrent reads or evict valid in-memory blocks.
      const pinned = binding.backing.backing.generation.pinnedEtag;
      if (object.state.pinnedEtag === null) {object.state.pinnedEtag = pinned;}
      else if (pinned !== null && pinned !== object.state.pinnedEtag) {throw new ContentIOError("IDENTITY_CHANGED");}
      object.state.persistPin = async (etag) => {
        if (this.degraded) {return;}
        await this.optional(() => binding.backing.pin(etag),undefined,binding.backing.resources.data.backend);
      };
    }
  }
  async read(object: BlockObject, index: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const binding = this.bindings.get(object.key);
    if (binding && !this.degraded) {
      const cached = await this.optional((active) => binding.backing.read(index, active), signal,binding.backing.resources.data.backend,"CACHE_READ");
      if (cached) {this.cacheBytes += cached.length; return cached;}
    }
    const previous=await this.previous(object,index,signal);
    if(previous){if(binding===this.bindings.get(object.key)&&binding&&!this.degraded){await this.save(object,binding,index,previous,signal);}this.cacheBytes+=previous.length;return previous;}
    const bytes = await fetchRangeBlock(object.source, object.state, index, signal, 15000, this.httpTelemetry);
    if (binding && binding===this.bindings.get(object.key) && !this.degraded) {await this.save(object, binding, index, bytes, signal);}
    return bytes;
  }
  async saveBlock(object: BlockObject, index: number, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void> {
    await this.prepare(object, signal);
    const binding = this.bindings.get(object.key);
    if (binding && !this.degraded) {await this.save(object, binding, index, bytes, signal, "RANGE_VALIDATED");}
  }
  countNetwork(bytes: number): void {this.networkBytes += bytes;}
  persistent(object: BlockObject): PersistentBacking | undefined {return this.degraded ? undefined : this.bindings.get(object.key)?.backing;}
  async local(object: BlockObject, index: number, signal: AbortSignal, allowStaged = false): Promise<Uint8Array<ArrayBuffer> | null> {
    const backing = this.persistent(object);
    const bytes = backing ? await this.optional((active) => backing.read(index, active, allowStaged), signal,backing.resources.data.backend,"CACHE_READ") : null;
    if (bytes) {this.cacheBytes += bytes.length;}
    return bytes ?? await this.previous(object,index,signal,allowStaged);
  }
  async stage(object: BlockObject, index: number, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void> {
    const binding = this.bindings.get(object.key);
    if (binding && !this.degraded) {await this.write(binding, index, bytes, signal, "STAGED_FULL");}
  }
  release(key: string): void {this.bindings.get(key)?.release();this.bindings.delete(key);this.preparing.delete(key);
    for(const old of this.retired.get(key)??[]){old.release();}this.retired.delete(key);
  }
  close(): void {
    this.controller.abort(); this.selector.close();
    for (const release of [...this.useLeases]) {release();}
    for (const binding of this.bindings.values()) {binding.release();}
    for(const old of this.retired.values()){for(const binding of old){binding.release();}}this.retired.clear();
    this.bindings.clear(); this.preparing.clear();
  }
  async lease(resources: PersistentResources, key: string, signal: AbortSignal): Promise<() => void> {
    checkSignal(this.controller.signal); checkSignal(signal);
    const physicalRelease = await resources.locks.use(key, signal);
    const release = () => {if (this.useLeases.delete(release)) {physicalRelease();}};
    this.useLeases.add(release); this.peakLeases = Math.max(this.peakLeases, this.useLeases.size);
    try {checkSignal(this.controller.signal); checkSignal(signal); return release;} catch (error) {release(); throw error;}
  }
  private async attach(object: BlockObject): Promise<Binding | null> {
    const epoch=this.epoch;
    const resources = await this.selector.select();
    if (!resources) {return null;}
    return await this.optional((signal) => this.bind(object, resources, signal,epoch),undefined,resources.data.backend) ?? null;
  }
  private async bind(object: BlockObject, resources: PersistentResources, signal: AbortSignal,epoch:number): Promise<Binding> {
    let release: (() => void) | undefined;
    try {
      release = await this.lease(resources, object.key, signal); checkSignal(signal);
      const backing = await resources.locks.data(object.key, signal, () => resources.metadata.attach(object.key, object.source, resources.data.backend,this.switched));
      checkSignal(signal);if(epoch!==this.epoch){throw new ContentIOError("CACHE_UNAVAILABLE");}
      const binding = {backing: new PersistentBacking(resources, backing, object, () => {this.corruptBlocks++;}), release};
      if (object.state.pinnedEtag !== null) {await binding.backing.pin(object.state.pinnedEtag);}
      await this.history(object, binding, signal);
      checkSignal(signal);
      this.bindings.set(object.key, binding);
      if(!this.collectors.has(resources)){const collector=new ContentGC(resources.metadata,resources.locks,this.selector.availableStores);this.collectors.set(resources,collector);void collector.collect().catch(()=>{});}
      return binding;
    } catch (error) {release?.(); throw error;}
  }
  private async history(object: BlockObject, binding: Binding, signal: AbortSignal): Promise<void> {
    const records = await binding.backing.resources.metadata.generations(object.key);
    const old = this.retired.get(object.key) ?? [];
    for (const generation of records) {
      if (generation.state === "QUARANTINED" || generation.generation === binding.backing.generation ||
        old.some(item => item.backing.generation === generation.generation)) {continue;}
      const resources = await this.selector.readable(generation.backend); checkSignal(signal);
      if (!resources) {continue;}
      // The active binding already holds the object-wide use lease. Alternate
      // generations remain read-only; switching backends never changes current.
      old.push({backing: new PersistentBacking(resources, {object: binding.backing.backing.object, generation}, object, () => {this.corruptBlocks++;}), release: () => {}});
    }
    this.retired.set(object.key, old);
  }
  private async save(object: BlockObject, binding: Binding, index: number, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal,
    provenance: BlockReceipt["provenance"] = "RANGE_VALIDATED"): Promise<void> {
    if (await this.write(binding, index, bytes, signal, provenance)) {return;}
    // Keep the already verified block while the optional backend changes. One
    // bounded retry can persist it without another HTTP request or a whole copy.
    await this.prepare(object, signal);
    const next = this.bindings.get(object.key);
    if (next && next !== binding && !this.degraded) {await this.write(next, index, bytes, signal, provenance);}
  }
  private async write(binding: Binding, index: number, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal, provenance: BlockReceipt["provenance"] = "RANGE_VALIDATED"): Promise<boolean> {
    return await this.optional(async (active) => {
      while (this.writes.size >= 2) {await abortable(Promise.race(this.writes), active);}
      checkSignal(active);
      const release = await this.credits.reserve(bytes.length, "CACHE_WRITE", active);
      let pending: Promise<void> | undefined;
      try {
        checkSignal(active); const copy = bytes.slice();
        pending = binding.backing.write(index, copy, active, provenance); this.writes.add(pending);
        await pending;this.addedBytes+=copy.length;
        if(this.addedBytes>=64*1024*1024){this.addedBytes=0;void this.collectors.get(binding.backing.resources)?.collect().catch(()=>{});}
        return true;
      } finally {release(); if (pending) {this.writes.delete(pending);}}
    }, signal,binding.backing.resources.data.backend,"CACHE_WRITE") ?? false;
  }
  private async optional<Value>(operation: (signal: AbortSignal) => Promise<Value>, signal?: AbortSignal,backend?:string, operationName: CacheOperation = "CACHE_PROBE"): Promise<Value | undefined> {
    const combined = combineSignals([this.controller.signal, ...(signal ? [signal] : [])]);
    const scope = requestScope(combined.signal, 500);
    try {return await abortable(operation(scope.signal), scope.signal);}
    catch (error) {
      checkSignal(combined.signal);
      if (error instanceof ContentIOError && error.scope === "OBJECT") {throw error;}
      this.degrade(backend, error, operationName);return undefined;
    } finally {scope.dispose(); combined.dispose();}
  }
  private async previous(object:BlockObject,index:number,signal:AbortSignal,allowStaged=false):Promise<Uint8Array<ArrayBuffer>|null>{
    for(const binding of this.retired.get(object.key)??[]){
      const bytes=await this.optional(active=>binding.backing.read(index,active,allowStaged),signal,binding.backing.resources.data.backend,"CACHE_READ");
      if(bytes){return bytes;}
    }
    return null;
  }
  private degrade(backend: string | undefined, cause: unknown, operation: CacheOperation): void {
    if(this.failedBackends.has(backend??"METADATA")||this.controller.signal.aborted){return;}
    this.failedBackends.add(backend??"METADATA");this.degraded=true;this.switched=true;this.epoch++;
    for(const [key,binding] of this.bindings){const old=this.retired.get(key)??[];old.push(binding);this.retired.set(key,old);}
    this.bindings.clear();this.preparing.clear();
    this.diagnostic(cause instanceof ContentIOError ? cause : new ContentIOError("CACHE_UNAVAILABLE"), operation);
    void this.selector.degrade().then(resources=>{if(!this.controller.signal.aborted){this.degraded=resources===null;}});
  }

}
