import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import {checkSignal} from "./abort.js";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {fail} from "./errors.js";
import {ContentMaterializer} from "./materializer.js";
import {contentObjectKey, validateSource, type SourceContext} from "./source.js";
import {ContentStoreManager} from "./store/manager.js";
import {completeBacking} from "./store/complete.js";
import {WindowLoader} from "./window-loader.js";

/** Preparation owns cache leases until the game exits, including files not opened by the core yet. */
export class ContentPreloader {
  private readonly controller = new AbortController();
  private readonly pool: BlockPool;
  private readonly store: ContentStoreManager;
  private readonly materializer: ContentMaterializer;
  private started = false;

  constructor(private readonly context: SourceContext) {
    this.pool = new BlockPool(0, (object, index, signal) => this.store.read(object, index, signal),
      undefined, (object, signal) => this.store.prepare(object, signal), {
        policy: {smallFileThresholdBytes: 1024 * 1024, networkWindowBytes: 2 * 1024 * 1024},
        local: (object, index, signal) => this.store.local(object, index, signal ?? this.controller.signal),
        load: (object, window, signal, origins) => windows.load(object, window, signal, origins),
      });
    this.store = new ContentStoreManager(context.storageOrigin, this.pool.credits);
    const windows = new WindowLoader(this.store, this.pool.cache, (object, index) => this.pool.key(object, index));
    this.materializer = new ContentMaterializer(this.pool, this.store);
  }

  async prepare(inputs: readonly ContentSourceV1[], report: (loaded: number, total: number) => void): Promise<void> {
    checkSignal(this.controller.signal);
    if (this.started || inputs.length > 100_000) {fail("SOURCE_INVALID");}
    this.started = true;
    const sources = new Map<string, ContentSourceV1>();
    for (const input of inputs) {
      const source = validateSource(input, this.context);
      sources.set(contentObjectKey(source, this.context.storageOrigin), source);
    }
    const total = [...sources.values()].reduce((sum, source) => sum + source.sizeBytes, 0);
    if (!Number.isSafeInteger(total)) {fail("BOUNDS");}
    let loaded = 0;
    report(loaded, total);
    for (const [key, source] of sources) {
      const object: BlockObject = {key, source, state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}};
      await this.prepareFile(object, ready => report(loaded + ready, total));
      loaded += source.sizeBytes;
      report(loaded, total);
    }
    // Release download buffers, but retain the store and its leases for the whole mounted runtime.
    this.materializer.close();
    this.pool.close();
  }

  close(): void {
    this.controller.abort();
    this.materializer.close();
    this.pool.close();
    this.store.close();
  }

  private async prepareFile(object: BlockObject, report: (ready: number) => void) {
    const signal = this.controller.signal;
    await this.store.prepare(object, signal);
    if (!this.store.persistent(object)) {fail("CACHE_UNAVAILABLE");}
    await this.materializer.prepare(object, {
      kind: "SINK", maxBytes: object.source.sizeBytes,
      createSink: async () => ({
        write: async () => {if (!this.store.persistent(object)) {fail("CACHE_UNAVAILABLE");}},
        abort: async () => {},
        commit: async receipt => {
          const backing = this.store.persistent(object);
          if (!backing || !await completeBacking(backing, receipt, this.pool.credits, signal)) {fail("CACHE_UNAVAILABLE");}
          checkSignal(signal);
        },
      }),
    }, signal, progress => report(progress.readyBytes));
  }
}
