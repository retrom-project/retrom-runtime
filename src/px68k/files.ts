import {sha256} from "@noble/hashes/sha2.js";
export type FileSource = {url: string; sha256: string; sizeBytes: number};
export async function fetchFile(source: FileSource, progress: (loaded: number) => void, signal?: AbortSignal) {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > 64 * 1024 * 1024 ||
    !/^[0-9a-f]{64}$/u.test(source.sha256)) {throw new Error("PX68K_FILE_INVALID");}
  let cache: Cache | null = null;
  const url = new URL(source.url, globalThis.location?.href).href;
  try {cache = await caches.open("retrom-px68k-content-v1");} catch { /* Storage may be unavailable. */ }
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const bytes = await read(hit, source, progress, signal);
        return bytes;
      }
    } catch {await cache.delete(url).catch(() => false); signal?.throwIfAborted();}
  }
  const response = await fetch(url, {credentials: "same-origin", signal});
  const bytes = await read(response, source, progress, signal);
  if (cache) {
    await cache.put(url, new Response(Uint8Array.from(bytes), {headers: {"Content-Type": "application/octet-stream"}})).catch(() => undefined);
  }
  return bytes;
}
async function read(response: Response, source: FileSource, progress: (loaded: number) => void, signal?: AbortSignal) {
  if (!response.ok || !response.body) {throw new Error("PX68K_FETCH_FAILED");}
  const bytes = new Uint8Array(source.sizeBytes), reader = response.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) {break;}
      if (offset + value.length > bytes.length) {throw new Error("PX68K_FILE_INVALID");}
      bytes.set(value, offset); offset += value.length; progress(offset);
    }
    const digest = Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
    if (offset !== source.sizeBytes || digest !== source.sha256) {throw new Error("PX68K_FILE_INVALID");}
    return bytes;
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
