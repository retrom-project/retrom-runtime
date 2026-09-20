import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {abortable, checkSignal, requestScope} from "./abort.js";
import {ContentIOError, fail} from "./errors.js";
import {BLOCK_BYTES, integer} from "./source.js";

export function isBytes(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}
export async function readExact(body: ReadableStream<Uint8Array> | null, expected: number, signal?: AbortSignal, consumed?: (bytes: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  if (!integer(expected, 0, BLOCK_BYTES)) {fail("BOUNDS");}
  checkSignal(signal);
  const output = new Uint8Array(expected);
  let written = 0;
  for await (const chunk of iterateExact(body, expected, signal, undefined, consumed)) {output.set(chunk, written); written += chunk.length;}
  return output;
}
export async function* iterateExact(body: ReadableStream<Uint8Array> | null, expected: number, signal?: AbortSignal,
  idleMs?: number, consumed?: (bytes: number) => void): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  if (!integer(expected)) {fail("BOUNDS");}
  checkSignal(signal);
  if (!body) {if (expected !== 0) {fail("LENGTH_MISMATCH");} return;}
  const reader = body.getReader();
  let read = 0, used = 0;
  let block = new Uint8Array(Math.min(BLOCK_BYTES, expected));
  try {
    for (;;) {
      const next = await nextChunk(reader, signal, idleMs);
      if (next.done) {break;}
      if (isBytes(next.value)) {consumed?.(next.value.byteLength);}
      if (!isBytes(next.value) || next.value.byteLength > expected - read) {fail("LENGTH_MISMATCH");}
      read += next.value.byteLength;
      let offset = 0;
      while (offset < next.value.byteLength) {
        const count = Math.min(block.length - used, next.value.byteLength - offset);
        block.set(next.value.subarray(offset, offset + count), used); used += count; offset += count;
        if (used === block.length) {
          checkSignal(signal); yield block;
          used = 0; block = new Uint8Array(Math.min(BLOCK_BYTES, expected - (read - next.value.byteLength + offset)));
        }
      }
    }
    if (read !== expected || used !== 0) {fail("LENGTH_MISMATCH");}
    checkSignal(signal);
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal, idleMs?: number) {
  const idle = idleMs === undefined ? undefined : requestScope(signal, idleMs);
  const active = idle?.signal ?? signal;
  try {return await abortable(reader.read(), active);}
  catch (cause) {
    checkSignal(active);
    if (cause instanceof ContentIOError) {throw cause;}
    throw new ContentIOError("NETWORK_FAILED", {cause, retryable: true});
  } finally {idle?.dispose();}
}
export function createContentHasher() {
  const hash = sha256.create();
  return {update: (bytes: Uint8Array) => {hash.update(bytes);}, digest: () => bytesToHex(hash.digest()), destroy: () => hash.destroy()};
}
export async function hashStream(stream: AsyncIterable<Uint8Array>, consume?: (chunk: Uint8Array) => Promise<void>) {
  const hash = createContentHasher();
  let sizeBytes = 0;
  try {
    for await (const chunk of stream) {hash.update(chunk); sizeBytes += chunk.byteLength; await consume?.(chunk);}
    return {sizeBytes, sha256: hash.digest()};
  } finally {hash.destroy();}
}
