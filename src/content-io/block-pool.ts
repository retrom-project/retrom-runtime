import type {ReadOptions, ReadOrigin} from "./read-accounting.js";
import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import {checkSignal} from "./abort.js";
import {BufferCredits} from "./credits.js";
import {ContentIOError, fail, toContentIOError} from "./errors.js";
import {blockRange, fetchRangeBlock, type ContentObjectState} from "./http.js";
import {fetchWindow, nextFetchWindow, MAX_FETCH_BYTES, type FetchPolicy, type FetchWindow} from "./fetch-policy.js";
import {BLOCK_BYTES} from "./source.js";
import {ByteLRU} from "./lru.js";
import {BlockScheduler} from "./scheduler.js";
export type BlockObject = {key: string; source: ContentSourceV1; state: ContentObjectState};
class StorageGenerationChanged extends ContentIOError {constructor(){super("CACHE_UNAVAILABLE");}}
type BufferLease = {start?: number; origins?: ReadOrigin[]; bytes: Uint8Array<ArrayBuffer>; release: () => void};
export type WindowSource = {policy: FetchPolicy; local: (object: BlockObject, index: number, signal?: AbortSignal) => Promise<Uint8Array<ArrayBuffer> | null>;
  load: (object: BlockObject, window: FetchWindow, signal: AbortSignal, origins?: ReadOrigin[]) => Promise<Uint8Array<ArrayBuffer>>};
export type BlockLoader = (object: BlockObject, index: number, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>;
/** One pool per Session. Consumers only receive copies, never LRU or network backings. */
export class BlockPool {
  readonly credits = new BufferCredits();
  readonly cache: ByteLRU;
  readonly scheduler = new BlockScheduler<BufferLease>((lease) => lease.release());
  private readonly reported = new WeakSet<BlockObject>();
  private readonly controller = new AbortController();
  constructor(l1Bytes = 0, private readonly load: BlockLoader = (object, index, signal) =>
    fetchRangeBlock(object.source, object.state, index, signal),
    private readonly failure: (object: BlockObject, error: ContentIOError) => void = () => {},
    private readonly prepare: (object: BlockObject, signal?: AbortSignal) => Promise<void> = async () => {}, private readonly windows?: WindowSource) {
    if (l1Bytes !== 0 && l1Bytes !== 2 * 1024 * 1024) {fail("CAPACITY_EXCEEDED");}
    this.cache = new ByteLRU(16 * 1024 * 1024 - l1Bytes);
  }
  get stats() {return {...this.scheduler.stats, ...this.credits.stats, lruBytes: this.cache.byteLength};}
  get peaks() {return {...this.scheduler.peaks, ...this.credits.peaks, lruBytes: this.cache.peakByteLength};}
  key(object: BlockObject, index: number): string {return `${object.key}:${object.state.generation}:${index}`;}
  check(object: BlockObject): void {
    checkSignal(this.controller.signal);
    if (object.state.revoked) {fail("IDENTITY_CHANGED");}
  }
  async copy(object: BlockObject, index: number, offset: number, destination: Uint8Array,
    guard: () => void, options: ReadOptions = {}): Promise<void> {
    for(let attempt=0;;attempt++){
      try{return await this.copyGeneration(object,index,offset,destination,guard,options);}
      catch(error){if(!(error instanceof StorageGenerationChanged)||attempt>=2){throw this.report(object, error);}}
    }
  }
  private async copyGeneration(object: BlockObject, index: number, offset: number, destination: Uint8Array,
    guard: () => void, options: ReadOptions): Promise<void> {
    this.check(object); checkSignal(options.signal); guard();
    await this.prepare(object, options.signal);
    this.check(object); checkSignal(options.signal); guard();
    const range = blockRange(object.source, index);
    const generation = object.state.generation, length = destination.byteLength;
    if (this.cache.copyInto(this.key(object, index), offset, destination)) {options.copied?.("MEMORY", length); return;}
    const window = this.windows ? fetchWindow(object.source.sizeBytes, index, this.windows.policy) : undefined;
    const taskKey = this.taskKey(object, index, window);
    // Join an existing physical request before local I/O can delay promotion or cancellation ownership.
    if (!this.scheduler.has(taskKey) && this.windows && await this.local(object, index, offset, destination, guard, options)) {return;}
    await this.scheduler.consume(taskKey, (signal) => this.acquire(object, index, signal, window), (lease) => {
      this.check(object); checkSignal(options.signal); guard();
      if (object.state.generation !== generation) {throw new StorageGenerationChanged();}
      if (destination.byteLength !== length || offset < 0 || length > range.length - offset) {fail("BOUNDS");}
      const start = range.start + offset - (lease.start ?? range.start);
      destination.set(lease.bytes.subarray(start, start + length));
      options.copied?.(lease.origins?.[Math.floor(start / BLOCK_BYTES)] ?? "NETWORK", length);
    }, {...options, whole: window?.wholeFile ?? options.whole});
  }
  /** Internal demand notification; callers never wait for speculative work. */
  prefetchAfter(object: BlockObject, index: number, signal: AbortSignal): void {
    if (!this.windows || signal.aborted || this.controller.signal.aborted || object.state.revoked) {return;}
    const window = nextFetchWindow(object.source.sizeBytes, index, this.windows.policy);
    if (!window || !this.scheduler.canPrefetch) {return;}
    const taskKey = this.taskKey(object, window.firstBlock, window);
    if (this.scheduler.has(taskKey) || this.cached(object, window)) {return;}
    const release = this.credits.tryReserveScratch(window.length + 2 * BLOCK_BYTES, MAX_FETCH_BYTES + 3 * BLOCK_BYTES);
    if (!release) {return;}
    const generation = object.state.generation;
    try {
      void this.scheduler.consume(taskKey, async active => {
        try {
          await this.prepare(object, active);
          this.check(object); checkSignal(active);
          if (object.state.generation !== generation) {throw new StorageGenerationChanged();}
          return await this.acquire(object, window.firstBlock, active, window, release);
        } catch (cause) {release(); throw this.report(object, cause);}
      }, () => {}, {signal, priority: "PREFETCH"}).catch(() => {
        // Physical failures already passed through report; ordinary speculative failures are optional.
      });
    } catch (cause) {release(); this.report(object, cause);}
  }
  private cached(object: BlockObject, window: FetchWindow): boolean {
    for (let n = 0; n < window.blockCount; n++) {
      if (!this.cache.has(this.key(object, window.firstBlock + n), Math.min(BLOCK_BYTES, window.length - n * BLOCK_BYTES))) {return false;}
    }
    return true;
  }
  private taskKey(object: BlockObject, index: number, window?: FetchWindow): string {
    const physical = window ? `${object.key}:${object.state.generation}:window:${window.start}:${window.length}` : this.key(object, index);
    return JSON.stringify([physical, "RANGE", object.source.etagPolicy, object.source.contentLengthPolicy]);
  }
  close(reason = new ContentIOError("ABORTED")): void {
    this.controller.abort(reason); this.scheduler.close(reason); this.cache.clear();
  }
  private async local(object: BlockObject, index: number, offset: number, destination: Uint8Array,
    guard: () => void, options: ReadOptions): Promise<boolean> {
    const release = await this.credits.reserve(2 * BLOCK_BYTES, "SCRATCH", options.signal);
    try {
      const bytes = await this.windows!.local(object, index, options.signal);
      this.check(object); checkSignal(options.signal); guard();
      if (!bytes) {return false;}
      this.cache.put(this.key(object, index), bytes); destination.set(bytes.subarray(offset, offset + destination.length));
      options.copied?.("PERSISTENT", destination.length); return true;
    } finally {release();}
  }
  private async acquire(object: BlockObject, index: number, signal: AbortSignal, window?: FetchWindow, reserved?: () => void): Promise<BufferLease> {
    const generation = object.state.generation, key = this.key(object, index);
    const range = blockRange(object.source, index);
    // readExact uses an output and one bounded stream block. Reserve before either allocation.
    const release = reserved ?? await this.credits.reserve(window ? window.length + 2 * BLOCK_BYTES : 2 * range.length, "SCRATCH", signal);
    try {
      this.check(object); checkSignal(signal);
      const cached = window ? null : this.cache.get(key), origins: ReadOrigin[] = [];
      const bytes = window ? await this.windows!.load(object, window, signal, origins) : cached ?? await this.load(object, index, signal);
      this.check(object); checkSignal(signal);
      if (object.state.generation !== generation) {throw new StorageGenerationChanged();}
      if (bytes.byteLength !== (window?.length ?? range.length)) {fail("LENGTH_MISMATCH");}
      if (window) {
        for (let n = 0; n < window.blockCount; n++) {this.cache.put(this.key(object, window.firstBlock + n), bytes.subarray(n * BLOCK_BYTES, (n + 1) * BLOCK_BYTES));}
      } else if (!cached) {this.cache.put(key, bytes);}
      return {bytes, release, start: window?.start, origins: cached ? ["MEMORY"] : origins};
    } catch (cause) {
      release(); throw this.report(object, cause);
    }
  }
  private report(object: BlockObject, cause: unknown): ContentIOError {
    const error = toContentIOError(cause);
    if (error.scope === "OBJECT") {object.state.revoked = true; this.cache.deletePrefix(`${object.key}:`);}
    if (error.scope === "SESSION") {this.close(error);}
    if (error.scope !== "REQUEST" && !this.reported.has(object)) {
      this.reported.add(object); this.failure(object, error);
    }
    return error;
  }
}
