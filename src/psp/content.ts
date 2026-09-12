import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";

// Core assets are fully verified before execution; game discs use the core's bounded Range reader.
export async function loadPSPFile(source: {url: string; sizeBytes: number; sha256: string}, signal?: AbortSignal): Promise<void> {
  const invalid = () => new Error("PPSSPP_CONTENT_INVALID");
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > 128 * 1024 * 1024 ||
    !/^[0-9a-f]{64}$/u.test(source.sha256)) {throw invalid();}
  signal?.throwIfAborted();
  const response = await fetch(source.url, {credentials: "same-origin", redirect: "error", signal});
  if (!response.ok || !response.body) {throw new Error("PPSSPP_CONTENT_FETCH_FAILED");}
  const reader = response.body.getReader(), hash = sha256.create();
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted(); const {done, value} = await reader.read(); if (done) {break;}
      size += value.byteLength; if (size > source.sizeBytes) {throw invalid();}
      hash.update(value);
    }
    if (size !== source.sizeBytes || bytesToHex(hash.digest()) !== source.sha256) {throw invalid();}
    signal?.throwIfAborted();
  } finally {hash.destroy(); await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
