import type {ReadOptions} from "./read-accounting.js";
import type {ContentMessageV1} from "../../contracts/content-io/v1/content-io.js";
import {checkSignal} from "./abort.js";
import type {BlockObject} from "./block-pool.js";
import {PortRPC} from "./bridge/async.js";
import {base} from "./bridge/protocol.js";
import {ContentIOError, fail} from "./errors.js";
import {blockRange} from "./http.js";
import {ByteLRU} from "./lru.js";
import {BlockScheduler} from "./scheduler.js";
type Reply = {message: Extract<ContentMessageV1, {type: "READ_OK"}>; rpc: PortRPC; release: () => void};
export class ClientBlocks {
  readonly cache = new ByteLRU(2 * 1024 * 1024);
  private readonly scheduler = new BlockScheduler<Reply>(({message, rpc, release}) => {
    try {if (!rpc.stats.closed) {rpc.send({...base(rpc.address, 0), type: "READ_ACK", ackRequestId: message.requestId});}} finally {release();}
  });
  private readonly identities = new WeakMap<BlockObject, string>();
  private closed: ContentIOError | undefined;
  constructor(private readonly channel: (object: BlockObject, signal?: AbortSignal) => Promise<{fileId: string; rpc: PortRPC; release: () => void}>) {}
  get stats() {return {...this.scheduler.stats, lruBytes: this.cache.byteLength};}
  key(object: BlockObject, index: number): string {return `${object.key}:${object.state.generation}:${index}`;}
  check(object: BlockObject): void {if (this.closed) {throw this.closed;} if (object.state.revoked) {fail("IDENTITY_CHANGED");}}
  close(error = new ContentIOError("ABORTED")): void {this.closed = error; this.scheduler.close(error); this.cache.clear();}
  async copy(object: BlockObject, index: number, offset: number, destination: Uint8Array, guard: () => void, options: ReadOptions = {}) {
    this.check(object); guard(); checkSignal(options.signal);
    const key = this.key(object, index), {start, length} = blockRange(object.source, index), count = destination.byteLength;
    if (this.cache.copyInto(key, offset, destination)) {options.copied?.("MEMORY", count); return;}
    const started = performance.now();
    if (!this.identities.has(object)) {this.identities.set(object, crypto.randomUUID());}
    await this.scheduler.consume(`${key}:${this.identities.get(object)}`, async (signal) => {
      const {fileId, rpc, release} = await this.channel(object, signal);
      try {
      const timeoutMs = Math.max(1, Math.floor(15000 - (performance.now() - started)));
      const message = await rpc.request({type: "READ", fileId, offset: start, length, timeoutMs}, "READ_OK", {signal, timeoutMs,
        cancel: (requestId) => rpc.send({...base(rpc.address, 0), type: "CANCEL", cancelRequestId: requestId})});
      if (message.fileId !== fileId || message.offset !== start || message.length !== length) {
        rpc.close(new ContentIOError("RANGE_INVALID")); fail("RANGE_INVALID");
      }
      // A cancelled consumer must ACK a late reply without storing it.
      if (!signal.aborted && !object.state.revoked && !this.closed) {this.cache.put(key, new Uint8Array(message.bytes));}
      return {message, rpc, release};
      } catch (error) {release();throw error;}
    }, ({message}) => {
      this.check(object); guard(); checkSignal(options.signal);
      if (destination.byteLength !== count) {fail("BOUNDS");}
      destination.set(new Uint8Array(message.bytes, offset, count)); options.copied?.(message.origin, count);
    }, options);
  }
}
