import {writeSyncMetrics} from "./sync-metrics.js";
import {ReadAccounting} from "./read-accounting.js";
import {base, parseMessage} from "./bridge/protocol.js";
import {blockingRead, checkSlot, closeSyncBuffer, controls} from "./bridge/blocking.js";
import {fail} from "./errors.js";
import {ByteLRU} from "./lru.js";
import {BLOCK_BYTES, integer, isDigest, validateReadBounds} from "./source.js";
export {abi, contractSha256} from "./identity.js";
type Options = {fileId: string; objectKey: string; sizeBytes: number; port: MessagePort; buffer: SharedArrayBuffer;
  sessionId: string; channelId: string; epoch: number; l1BudgetBytes: number};
export function createSyncContentReader(options: Options) {
  if (typeof document !== "undefined" || !integer(options.sizeBytes) || !isDigest(options.objectKey) || !integer(options.l1BudgetBytes, 0, 2097152)) {fail("SOURCE_INVALID");}
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  if (![options.fileId, options.sessionId, options.channelId].every(value => uuid.test(value)) || !integer(options.epoch,1,2147483647)) {fail("SOURCE_INVALID");}
  const control = controls(options.buffer), cache = new ByteLRU(options.l1BudgetBytes);
  const address = {sessionId: options.sessionId, channelId: options.channelId, epoch: options.epoch};
  let sequence = 0;
  const accounting = new ReadAccounting();
  const report = () => writeSyncMetrics(control, {...accounting.counts, cacheBytesL1: cache.byteLength, peakCacheBytesL1: cache.peakByteLength});
  const key = (index: number) => `${options.objectKey}:${index}`;
  const check = () => {try {checkSlot(control, options.epoch);} catch (error) {cache.clear(); report(); throw error;}};
  const tryReadInto = (offset: number, destination: Uint8Array): number | null => {
    check(); validateReadBounds(options.sizeBytes, offset, destination.length);
    if (destination.length === 0) {return 0;}
    const first = Math.floor(offset / BLOCK_BYTES), last = Math.floor((offset + destination.length - 1) / BLOCK_BYTES);
    for (let index = first; index <= last; index++) {if (!cache.has(key(index), Math.min(BLOCK_BYTES, options.sizeBytes - index * BLOCK_BYTES))) {return null;}}
    for (let written = 0; written < destination.length;) {
      const position = offset + written, within = position % BLOCK_BYTES, length = Math.min(BLOCK_BYTES - within, destination.length - written);
      cache.copyInto(key(Math.floor(position / BLOCK_BYTES)), within, destination.subarray(written, written + length)); written += length;
    }
    accounting.copied("MEMORY", destination.length); report(); return destination.length;
  };
  const readInto = (offset: number, destination: Uint8Array, timeoutMs = 15000): number => {
    check(); validateReadBounds(options.sizeBytes, offset, destination.length);
    if (!integer(timeoutMs, 1, 15000)) {fail("BOUNDS");}
    const deadline = performance.now() + timeoutMs;
    for (let written = 0; written < destination.length;) {
      check(); const position = offset + written, index = Math.floor(position / BLOCK_BYTES), within = position % BLOCK_BYTES;
      const count = Math.min(destination.length - written, BLOCK_BYTES - within), target = destination.subarray(written, written + count);
      if (!cache.copyInto(key(index), within, target)) {
        const remaining = Math.floor(deadline - performance.now()); if (remaining <= 0) {closeSyncBuffer(options.buffer, 9); fail("TIMEOUT");}
        if (sequence >= 2147483647) {closeSyncBuffer(options.buffer,14);cache.clear();fail("CAPACITY_EXCEEDED");}
        const id = ++sequence, length = Math.min(BLOCK_BYTES, options.sizeBytes - index * BLOCK_BYTES);
        blockingRead({buffer: options.buffer, epoch: options.epoch, requestId: id, length, timeoutMs: remaining,
          send: () => options.port.postMessage({...base(address, id), type: "READ", fileId: options.fileId, offset: index * BLOCK_BYTES, length, timeoutMs: remaining}),
          acknowledge: () => options.port.postMessage({...base(address, 0), type: "SLOT_FREE", completedRequestId: id}),
          cancel: () => options.port.postMessage({...base(address, 0), type: "CANCEL", cancelRequestId: id}),
          consume: (bytes, origin) => {check(); cache.put(key(index), bytes); target.set(bytes.subarray(within, within + count)); accounting.copied(origin, count); report();}});
      } else {accounting.copied("MEMORY", count); report();}
      written += count;
    }
    report(); return destination.length;
  };
  const close = () => {
    const alreadyClosed = Atomics.load(control, 6) !== 0; closeSyncBuffer(options.buffer); cache.clear(); report();
    try {if (!alreadyClosed) {options.port.postMessage({...base(address, ++sequence), type: "CLOSE_CHANNEL"});}} finally {options.port.close();}
  };
  options.port.onmessage = ({data}: MessageEvent<unknown>) => {
    try {if (parseMessage(data, address).type === "CHANNEL_CLOSED") {cache.clear(); report(); options.port.close();}}
    catch {closeSyncBuffer(options.buffer, 17); cache.clear(); report(); options.port.close();}
  };
  options.port.start();
  return {readInto, tryReadInto, close, get stats() {return {lruBytes: cache.byteLength, peakLruBytes: cache.peakByteLength, ...accounting.counts};}};
}
