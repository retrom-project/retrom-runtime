import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import {ContentIOError, toContentIOError} from "../content-io/errors.js";
import {BLOCK_BYTES, integer} from "../content-io/source.js";

const words = 16;
const closedState = 4;
// Core-owned content-read-v1 slot; native threads serialize reads without
// proxying through the core's main worker (which can be paused for a checkpoint).
export function serveContentReads(buffer: SharedArrayBuffer, offset: number, readers: readonly ContentReaderV1[],
  onFailure: (error: Error) => void) {
  if (Object.prototype.toString.call(buffer) !== "[object SharedArrayBuffer]" || !integer(offset) || offset % 4 ||
    offset > buffer.byteLength - words * 4 - BLOCK_BYTES) {throw new ContentIOError("ABI_MISMATCH");}
  const control = new Int32Array(buffer, offset, words);
  const payload = new Uint8Array(buffer, offset + words * 4, BLOCK_BYTES);
  if (Atomics.load(control, 1) !== 1) {throw new ContentIOError("ABI_MISMATCH");}
  const controller = new AbortController();
  let sequence = 0;
  const close = () => {
    controller.abort(); Atomics.store(control, 6, 1); Atomics.store(control, 0, closedState); Atomics.notify(control, 0);
  };
  const run = async () => {
    try {
      while (!controller.signal.aborted) {
        const state = Atomics.load(control, 0);
        if (Atomics.load(control, 6) !== 0 || state === closedState) {throw new ContentIOError("ABORTED");}
        if (state !== 1) {await waitForChange(control, state); continue;}
        const id = Atomics.load(control, 9), length = Atomics.load(control, 7), next = Atomics.load(control, 2);
        const at = (Atomics.load(control, 10) >>> 0) + (Atomics.load(control, 11) >>> 0) * 0x100000000;
        const reader = readers[id];
        validateRequest(control, reader, sequence, next, at, length);
        sequence = next;
        const timeout = setTimeout(() => controller.abort(new ContentIOError("TIMEOUT")), 15000);
        try {
          // The public reader owns cache policy, network validation and accounting.
          const bytes = new Uint8Array(length);
          const count = await reader.readInto(at, bytes, controller.signal);
          controller.signal.throwIfAborted();
          if (count !== length || Atomics.load(control, 6) || Atomics.load(control, 2) !== next) {throw new ContentIOError("RANGE_INVALID");}
          payload.set(bytes); Atomics.store(control, 4, length);
          if (Atomics.compareExchange(control, 0, 1, 2) !== 1) {throw new ContentIOError("ABORTED");}
          Atomics.notify(control, 0);
        } finally {clearTimeout(timeout);}
      }
    } catch (cause) {
      const report = !controller.signal.aborted || controller.signal.reason instanceof ContentIOError;
      const error = toContentIOError(controller.signal.reason instanceof ContentIOError ? controller.signal.reason : cause);
      close(); if (report) {onFailure(error);}
    }
  };
  void run();
  return close;
}

function validateRequest(control: Int32Array, reader: ContentReaderV1 | undefined, sequence: number, next: number, at: number, length: number) {
  if (Atomics.load(control, 1) !== 1 || next !== sequence + 1 || !reader || !integer(length, 1, BLOCK_BYTES) ||
    !integer(at) || at > reader.sizeBytes - length) {throw new ContentIOError("BOUNDS");}
}

async function waitForChange(control: Int32Array, state: number): Promise<void> {
  const atomics = Atomics as typeof Atomics & {waitAsync?: (array: Int32Array, index: number, value: number, timeout: number) => {value: string | Promise<string>}};
  if (atomics.waitAsync) {await atomics.waitAsync(control, 0, state, 1000).value;}
  else {await new Promise(resolve => setTimeout(resolve, 1));}
}
