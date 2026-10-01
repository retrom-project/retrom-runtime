import type {ReadOrigin} from "./read-accounting.js";
import {checkSignal} from "./abort.js";
import type {BlockObject} from "./block-pool.js";
import {createContentHasher} from "./bounded-stream.js";
import {fail} from "./errors.js";
import {type FetchWindow, missingRanges} from "./fetch-policy.js";
import {fetchRangeInto, fetchWholeStream} from "./http.js";
import type {ByteLRU} from "./lru.js";
import {BLOCK_BYTES} from "./source.js";
import type {ContentStoreManager} from "./store/manager.js";
import {completedBacking} from "./store/complete.js";
import type {PersistentBacking} from "./store/backing.js";

/** The caller reserves window.length + two blocks before entering this loader. */
export class WindowLoader {
  constructor(private readonly store: ContentStoreManager, private readonly cache: ByteLRU,
    private readonly key: (object: BlockObject, index: number) => string) {}
  async load(object: BlockObject, window: FetchWindow, signal: AbortSignal, origins: ReadOrigin[] = []): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = new Uint8Array(window.length), present = new Set<number>(), backing = this.store.persistent(object);
    for (let n = 0; n < window.blockCount; n++) {
      checkSignal(signal);
      origins[n] = "NETWORK";
      const index = window.firstBlock + n, output = bytes.subarray(n * BLOCK_BYTES, Math.min((n + 1) * BLOCK_BYTES, bytes.length));
      if (this.cache.copyInto(this.key(object, index), 0, output)) {origins[n] = "MEMORY"; present.add(index); continue;}
      const stored = await this.store.local(object, index, signal);
      if (stored) {origins[n] = "PERSISTENT"; output.set(stored); present.add(index);}
    }
    if (window.wholeFile && present.size === 0) {
      let offset = 0;
      for await (const chunk of fetchWholeStream({...object.source, transport: "WHOLE_ALLOWED"}, object.state, signal,
        this.store.httpTelemetry)) {bytes.set(chunk, offset); offset += chunk.length;}
    } else {
      for (const range of missingRanges(window, present)) {
        const offset = range.start - window.start;
        await fetchRangeInto(object.source, object.state, range.start, bytes.subarray(offset, offset + range.length), signal,
          this.store.httpTelemetry);
      }
    }
    checkSignal(signal);
    await this.verifyWholeFile(object, window, bytes, present.size, backing, signal);
    for (let n = 0; n < window.blockCount; n++) {
      const index = window.firstBlock + n;
      if (!present.has(index)) {
        await this.store.saveBlock(object, index, bytes.subarray(n * BLOCK_BYTES, Math.min((n + 1) * BLOCK_BYTES, bytes.length)), signal);
      }
    }
    return bytes;
  }
  private async verifyWholeFile(object: BlockObject, window: FetchWindow, bytes: Uint8Array, present: number,
    backing: PersistentBacking | undefined, signal: AbortSignal) {
    if (window.start !== 0 || window.length !== object.source.sizeBytes || object.source.identity.kind !== "FILE_SHA256") {return;}
    if (present === window.blockCount && backing && this.store.persistent(object) === backing && await completedBacking(backing, signal)) {return;}
    const hash = createContentHasher();
    try {hash.update(bytes); if (hash.digest() !== object.source.identity.sha256) {fail("CHECKSUM_MISMATCH");}}
    finally {hash.destroy();}
  }
}
