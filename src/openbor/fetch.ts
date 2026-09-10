import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type PakSource = {url: string; sizeBytes: number; sha256: string};
export const chunkSize = 4 * 1024 * 1024;
export const maximumPakBytes = 512 * 1024 * 1024;
export async function fetchPak(source: PakSource, progress: RuntimeProgressReporter, caches?: CacheStorage,
  signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 12 || source.sizeBytes > maximumPakBytes ||
    !/^[a-f0-9]{64}$/u.test(source.sha256)) {throw invalid();}
  signal?.throwIfAborted();
  let cache: Cache | undefined;
  try {cache = await caches?.open("retrom-openbor-pak-v1");} catch { /* Storage is optional. */ }
  const bytes = new Uint8Array(source.sizeBytes);
  const key = (offset: number) => `${source.url}${source.url.includes("?") ? "&" : "?"}openborChunk=${offset}`;
  if (await restoreChunks(cache, bytes, key, source.sha256, signal)) {
    progress({phase: "PROJECT_CONTENT", loadedBytes: bytes.length, totalBytes: bytes.length}); return bytes;
  }
  const response = await fetch(source.url, {credentials: "same-origin", signal});
  if (!response.ok || !response.body) {throw invalid();}
  const reader = response.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) {break;}
      if (offset + value.length > bytes.length) {throw invalid();}
      bytes.set(value, offset); offset += value.length;
      progress({phase: "PROJECT_CONTENT", loadedBytes: offset, totalBytes: bytes.length});
    }
    if (offset !== bytes.length) {throw invalid();}
    await verify(bytes, source.sha256);
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
  await storeChunks(cache, bytes, key, signal);
  return bytes;
}
async function storeChunks(cache: Cache | undefined, bytes: Uint8Array<ArrayBuffer>, key: (offset: number) => string,
  signal?: AbortSignal) {
  if (!cache) {return;}
  try {
    for (let start = 0; start < bytes.length; start += chunkSize) {
      signal?.throwIfAborted();
      await cache.put(key(start), new Response(bytes.slice(start, start + chunkSize)));
    }
  } catch {signal?.throwIfAborted();}
}
async function restoreChunks(cache: Cache | undefined, bytes: Uint8Array<ArrayBuffer>, key: (offset: number) => string,
  digest: string, signal?: AbortSignal) {
  if (!cache) {return false;}
  try {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      signal?.throwIfAborted();
      const response = await cache.match(key(offset));
      if (!response) {return false;}
      const part = new Uint8Array(await response.arrayBuffer());
      if (part.length !== Math.min(chunkSize, bytes.length - offset)) {return false;}
      bytes.set(part, offset);
    }
    await verify(bytes, digest); return true;
  } catch {signal?.throwIfAborted(); return false;}
}
async function verify(bytes: Uint8Array<ArrayBuffer>, digest: string) {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "PACK" || new DataView(bytes.buffer).getUint32(4, true) !== 0) {throw invalid();}
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if ([...hash].map((value) => value.toString(16).padStart(2, "0")).join("") !== digest) {throw invalid();}
}
function invalid() {return new Error("OPENBOR_CONTENT_INVALID");}
