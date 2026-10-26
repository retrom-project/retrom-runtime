import type {ReadObserver} from "./read-accounting.js";
import type {ReadProgress} from "./scheduler.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import {checkSignal, combineSignals, requestScope} from "./abort.js";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {ContentIOError, fail} from "./errors.js";
import {transientNetworkError, type NetworkWait} from "./network-wait.js";
import {BLOCK_BYTES, integer, validateReadBounds} from "./source.js";
/** Provider-internal reader access also carries request-scoped network progress. */
export type ProgressContentReader = Pick<RangeReader, keyof ContentReaderV1>;
export class RangeReader implements ContentReaderV1 {
  readonly abi = "content-io-v1" as const;
  readonly sizeBytes: number;
  private readonly controller = new AbortController();
  private closePromise: Promise<void> | undefined;
  constructor(readonly id: string, private readonly object: BlockObject, private readonly pool: Pick<BlockPool, "cache" | "key" | "check" | "copy"> & Partial<Pick<BlockPool, "prefetchAfter">>, private readonly onClose: () => Promise<void> = async () => {}, private readonly copied: ReadObserver = () => {},
    private readonly network?: NetworkWait) {
    this.sizeBytes = object.source.sizeBytes;
  }
  async readInto(offset: number, destination: Uint8Array, signal?: AbortSignal, copied: ReadObserver = this.copied,
    progress?: ReadProgress): Promise<number> {
    this.check(); validateReadBounds(this.sizeBytes, offset, destination.byteLength); checkSignal(signal);
    if (this.network) {return this.readWaitingForNetwork(this.network, offset, destination, signal, copied, progress);}
    const size = destination.byteLength;
    const combined = combineSignals([this.controller.signal, ...(signal ? [signal] : [])]);
    const scope = requestScope(combined.signal, 15000);
    try {
      for (let written = 0; written < size;) {
        this.check(); checkSignal(scope.signal);
        if (destination.byteLength !== size) {fail("BOUNDS");}
        const position = offset + written, index = Math.floor(position / BLOCK_BYTES), within = position % BLOCK_BYTES;
        const length = Math.min(size - written, BLOCK_BYTES - within);
        await this.pool.copy(this.object, index, within, destination.subarray(written, written + length),
          () => this.check(), {copied, signal: scope.signal, timeoutMs: 15000,
            progress: bytes => {scope.renew(); progress?.(bytes);}});
        this.check(); checkSignal(scope.signal);
        scope.renew(); this.pool.prefetchAfter?.(this.object, index, this.controller.signal, position + length);
        written += length;
      }
      this.check(); checkSignal(scope.signal); return size;
    } finally {scope.dispose(); combined.dispose();}
  }
  /**
   * Each block attempt keeps a 15-second idle bound, but a transient network failure waits for the
   * network and retries that block instead of failing the read. Only closing the reader or `signal` ends it.
   */
  private async readWaitingForNetwork(network: NetworkWait, offset: number, destination: Uint8Array,
    signal: AbortSignal | undefined, copied: ReadObserver, progress?: ReadProgress): Promise<number> {
    const size = destination.byteLength, token = {};
    const combined = combineSignals([this.controller.signal, ...(signal ? [signal] : [])]);
    try {
      for (let written = 0; written < size;) {
        const position = offset + written, index = Math.floor(position / BLOCK_BYTES), within = position % BLOCK_BYTES;
        const length = Math.min(size - written, BLOCK_BYTES - within);
        for (let attempt = 0; ; attempt++) {
          this.check(); checkSignal(combined.signal);
          if (destination.byteLength !== size) {fail("BOUNDS");}
          const scope = requestScope(combined.signal, 15000);
          try {
            await this.pool.copy(this.object, index, within, destination.subarray(written, written + length),
              () => this.check(), {copied, signal: scope.signal, timeoutMs: 15000,
                progress: bytes => {scope.renew(); progress?.(bytes);}});
            break;
          } catch (error) {
            if (combined.signal.aborted || !transientNetworkError(error)) {throw error;}
          } finally {scope.dispose();}
          await network.wait(token, attempt, combined.signal);
        }
        network.leave(token, true);
        this.check(); checkSignal(combined.signal);
        this.pool.prefetchAfter?.(this.object, index, this.controller.signal, position + length);
        written += length;
      }
      this.check(); checkSignal(combined.signal); return size;
    } finally {network.leave(token, false); combined.dispose();}
  }
  tryReadInto(offset: number, destination: Uint8Array): number | null {
    this.check(); validateReadBounds(this.sizeBytes, offset, destination.byteLength);
    const length = destination.byteLength;
    if (length === 0) {return 0;}
    const first = Math.floor(offset / BLOCK_BYTES), last = Math.floor((offset + length - 1) / BLOCK_BYTES);
    for (let index = first; index <= last; index++) {
      if (!this.pool.cache.has(this.pool.key(this.object, index), Math.min(BLOCK_BYTES, this.sizeBytes - index * BLOCK_BYTES))) {return null;}
    }
    for (let written = 0; written < length;) {
      const position = offset + written, index = Math.floor(position / BLOCK_BYTES), within = position % BLOCK_BYTES;
      const count = Math.min(length - written, BLOCK_BYTES - within);
      this.pool.cache.copyInto(this.pool.key(this.object, index), within, destination.subarray(written, written + count)); written += count;
    }
    this.copied("MEMORY", length);
    for (let index = first; index <= last; index++) {
      this.pool.prefetchAfter?.(this.object, index, this.controller.signal, Math.min(offset + length, (index + 1) * BLOCK_BYTES));
    }
    return length;
  }
  async *stream(offset: number, length: number, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    this.check(); checkSignal(signal);
    if (!integer(offset) || !integer(length) || offset > this.sizeBytes || length > this.sizeBytes - offset) {fail("BOUNDS");}
    for (let position = offset; position < offset + length;) {
      this.check(); checkSignal(signal);
      const count = Math.min(BLOCK_BYTES - position % BLOCK_BYTES, offset + length - position);
      // The yielded array belongs to the caller; it is not a retained public cache buffer.
      const chunk = new Uint8Array(count);
      await this.readInto(position, chunk, signal); yield chunk; position += count;
    }
  }
  close(reason = new ContentIOError("ABORTED")): Promise<void> {
    if (!this.closePromise) {this.controller.abort(reason); this.closePromise = Promise.resolve().then(this.onClose);}
    return this.closePromise;
  }
  private check(): void {checkSignal(this.controller.signal); this.pool.check(this.object);}
}
