import {integer} from "./source.js";
import {fail} from "./errors.js";
export type SyncMetrics = {memoryHitBytes: number; persistentHitBytes: number; cacheBytesL1: number; peakCacheBytesL1: number};
const word = 4294967296;
/** Single writer; the service never waits on the consumer's thread or event loop. */
export function writeSyncMetrics(control: Int32Array, value: SyncMetrics): void {
  if (![value.memoryHitBytes, value.persistentHitBytes].every(n => integer(n)) ||
    !integer(value.cacheBytesL1, 0, 2097152) || !integer(value.peakCacheBytesL1, value.cacheBytesL1, 2097152)) {fail("CAPACITY_EXCEEDED");}
  Atomics.add(control, 9, 1);
  Atomics.store(control, 10, value.memoryHitBytes % word); Atomics.store(control, 11, Math.floor(value.memoryHitBytes / word));
  Atomics.store(control, 12, value.persistentHitBytes % word); Atomics.store(control, 13, Math.floor(value.persistentHitBytes / word));
  Atomics.store(control, 14, value.cacheBytesL1); Atomics.store(control, 15, value.peakCacheBytesL1);
  Atomics.add(control, 9, 1);
}
export function readSyncMetrics(control: Int32Array): SyncMetrics | null {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = Atomics.load(control, 9); if (before & 1) {continue;}
    const memoryHitBytes = (Atomics.load(control, 10) >>> 0) + Atomics.load(control, 11) * word;
    const persistentHitBytes = (Atomics.load(control, 12) >>> 0) + Atomics.load(control, 13) * word;
    const cacheBytesL1 = Atomics.load(control, 14), peakCacheBytesL1 = Atomics.load(control, 15);
    if (Atomics.load(control, 9) !== before) {continue;}
    if (!integer(memoryHitBytes) || !integer(persistentHitBytes) || !integer(cacheBytesL1, 0, 2097152) || !integer(peakCacheBytesL1, cacheBytesL1, 2097152)) {fail("ABI_MISMATCH");}
    return {memoryHitBytes, persistentHitBytes, cacheBytesL1, peakCacheBytesL1};
  }
  return null;
}
