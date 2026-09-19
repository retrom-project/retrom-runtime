import type {ReadOrigin} from "../read-accounting.js";
import {ContentIOError, errorNumbers, fail} from "../errors.js";
import {BLOCK_BYTES, integer} from "../source.js";
import {wireError} from "./async.js";
export const controlBytes = 64;
export const slotBytes = controlBytes + BLOCK_BYTES;
export const State = Object.freeze({IDLE: 0, REQUESTED: 1, OK: 2, ERROR: 3, CLOSED: 4});
export function createSyncBuffer(epoch: number): SharedArrayBuffer {
  if (!integer(epoch, 1, 2147483647)) {fail("SOURCE_INVALID");}
  const buffer = new SharedArrayBuffer(slotBytes), control = new Int32Array(buffer, 0, 16);
  Atomics.store(control, 1, 1); Atomics.store(control, 3, epoch); return buffer;
}
export function controls(buffer: SharedArrayBuffer): Int32Array {
  if (Object.prototype.toString.call(buffer) !== "[object SharedArrayBuffer]" || buffer.byteLength !== slotBytes) {fail("SOURCE_INVALID");}
  const control = new Int32Array(buffer, 0, 16);
  if (Atomics.load(control, 1) !== 1 || !integer(Atomics.load(control, 8), 0, 2)) {fail("ABI_MISMATCH");}
  return control;
}
export function closeSyncBuffer(buffer: SharedArrayBuffer, reason = errorNumbers.ABORTED): void {
  const control = controls(buffer);
  Atomics.compareExchange(control, 5, 0, reason); Atomics.store(control, 6, 1);
  Atomics.store(control, 0, State.CLOSED); Atomics.notify(control, 0);
}
export function checkSlot(control: Int32Array, epoch: number): void {
  if (Atomics.load(control, 6) !== 0 || Atomics.load(control, 0) === State.CLOSED) {throw wireError(Atomics.load(control, 5) || errorNumbers.ABORTED);}
  if (Atomics.load(control, 3) !== epoch || Atomics.load(control, 1) !== 1) {fail("ABI_MISMATCH");}
}
export function requested(control: Int32Array, epoch: number, sequence: number, length: number): boolean {
  return Atomics.load(control, 6) === 0 && Atomics.load(control, 0) === State.REQUESTED && Atomics.load(control, 1) === 1 &&
    Atomics.load(control, 3) === epoch && Atomics.load(control, 2) === sequence && Atomics.load(control, 7) === length;
}
function readOrigin(control: Int32Array): ReadOrigin {
  const origin = Atomics.load(control, 8); if (!integer(origin, 0, 2)) {fail("ABI_MISMATCH");}
  return origin === 2 ? "PERSISTENT" : origin === 1 ? "MEMORY" : "NETWORK";
}
export function blockingRead(options: {buffer: SharedArrayBuffer; epoch: number; requestId: number; length: number; timeoutMs: number;
  send: () => void; acknowledge: () => void; cancel: () => void; consume: (bytes: Uint8Array<SharedArrayBuffer>, origin: ReadOrigin) => void}): void {
  if (typeof document !== "undefined") {fail("SOURCE_INVALID");}
  const control = controls(options.buffer); checkSlot(control, options.epoch);
  if (!integer(options.timeoutMs, 1, 15000) || !integer(options.length, 1, BLOCK_BYTES) || !integer(options.requestId, 1, 2147483647)) {fail("BOUNDS");}
  const deadline = performance.now() + options.timeoutMs;
  try {
    if (Atomics.load(control, 0) !== State.IDLE) {fail("RANGE_INVALID");}
    Atomics.store(control, 2, options.requestId); Atomics.store(control, 7, options.length); Atomics.store(control, 4, 0); Atomics.store(control, 8, 0);
    if (Atomics.compareExchange(control, 0, State.IDLE, State.REQUESTED) !== State.IDLE) {fail("ABORTED");}
    checkSlot(control, options.epoch); options.send();
    while (Atomics.load(control, 0) === State.REQUESTED) {
      checkSlot(control, options.epoch);
      const remaining = deadline - performance.now(); if (remaining <= 0) {fail("TIMEOUT");}
      Atomics.wait(control, 0, State.REQUESTED, remaining);
    }
    checkSlot(control, options.epoch);
    if (Atomics.load(control, 0) === State.ERROR) {throw wireError(Atomics.load(control, 5));}
    if (Atomics.load(control, 0) !== State.OK || Atomics.load(control, 2) !== options.requestId || Atomics.load(control, 4) !== options.length) {fail("RANGE_INVALID");}
    options.consume(new Uint8Array(options.buffer, controlBytes, options.length), readOrigin(control));
    if (Atomics.compareExchange(control, 0, State.OK, State.IDLE) !== State.OK) {fail("ABORTED");}
    checkSlot(control, options.epoch); options.acknowledge();
  } catch (error) {
    closeSyncBuffer(options.buffer, error instanceof ContentIOError ? error.codeNumber : errorNumbers.INTERNAL);
    try {options.cancel();} catch { /* The SAB already wakes the peer. */ }
    throw error;
  }
}
