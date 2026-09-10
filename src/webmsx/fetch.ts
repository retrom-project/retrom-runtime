import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type MediaSource = {mediaUrl: string; mediaSizeBytes: number; contentDigest: string};
export const maximumMediaBytes = 16 * 1024 * 1024;

export async function fetchMedia(source: MediaSource, progress: RuntimeProgressReporter,
  caches?: CacheStorage, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(source.mediaSizeBytes) || source.mediaSizeBytes < 8 || source.mediaSizeBytes > maximumMediaBytes ||
    !/^[a-f0-9]{64}$/u.test(source.contentDigest)) {throw invalid();}
  signal?.throwIfAborted();
  const cacheKey = new URL(`/__webmsx-content/${source.contentDigest}`, new URL(source.mediaUrl, window.location.href)).href;
  let cache: Cache | undefined;
  try {
    cache = await caches?.open("retrom-webmsx-content-v1");
    const response = await cache?.match(cacheKey);
    if (response) {return await read(response, source, progress, signal);}
  } catch {signal?.throwIfAborted();}
  const bytes = await read(await fetch(source.mediaUrl, {credentials: "same-origin", signal}), source, progress, signal);
  try {await cache?.put(cacheKey, new Response(bytes.slice()));} catch { /* Persistent storage is optional. */ }
  return bytes;
}

async function read(response: Response, source: MediaSource, progress: RuntimeProgressReporter, signal?: AbortSignal) {
  if (!response.ok || !response.body) {throw invalid();}
  const reader = response.body.getReader();
  const bytes = new Uint8Array(source.mediaSizeBytes);
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
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    if ([...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") !== source.contentDigest) {throw invalid();}
    return bytes;
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
function invalid() {return new Error("WEBMSX_CONTENT_INVALID");}
