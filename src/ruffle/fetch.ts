import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type SwfSource = {swfUrl: string; swfSizeBytes: number; contentDigest: string};
export const maximumSwfBytes = 64 * 1024 * 1024;

export async function fetchSwf(source: SwfSource, progress: RuntimeProgressReporter,
  caches?: CacheStorage, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(source.swfSizeBytes) || source.swfSizeBytes < 8 || source.swfSizeBytes > maximumSwfBytes ||
    !/^[a-f0-9]{64}$/u.test(source.contentDigest)) {throw invalid();}
  signal?.throwIfAborted();
  const cacheKey = new URL(`/__ruffle-content/${source.contentDigest}`, new URL(source.swfUrl, window.location.href)).href;
  let cache: Cache | undefined;
  try {
    cache = await caches?.open("retrom-ruffle-content-v1");
    const response = await cache?.match(cacheKey);
    if (response) {return await read(response, source, progress, signal);}
  } catch {signal?.throwIfAborted();}
  const bytes = await read(await fetch(source.swfUrl, {credentials: "same-origin", signal}), source, progress, signal);
  try {await cache?.put(cacheKey, new Response(bytes.slice()));} catch { /* Persistent storage is optional. */ }
  return bytes;
}

async function read(response: Response, source: SwfSource, progress: RuntimeProgressReporter, signal?: AbortSignal) {
  if (!response.ok || !response.body) {throw invalid();}
  const reader = response.body.getReader();
  const bytes = new Uint8Array(source.swfSizeBytes);
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
    validateHeader(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    if ([...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") !== source.contentDigest) {throw invalid();}
    return bytes;
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
function invalid() {return new Error("RUFFLE_CONTENT_INVALID");}

function validateHeader(bytes: Uint8Array) {
  const signature = String.fromCharCode(...bytes.subarray(0, 3));
  const declaredSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (!["FWS", "CWS", "ZWS"].includes(signature) || bytes[3] === 0 || declaredSize < 8 || declaredSize > maximumSwfBytes ||
    signature === "FWS" && declaredSize !== bytes.length || signature === "CWS" && bytes[3] < 6 ||
    signature === "ZWS" && (bytes[3] < 13 || bytes.length < 17)) {throw invalid();}
}
