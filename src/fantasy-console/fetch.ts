import {verifyBytes} from "./state.js";
export async function verifiedFetch(url: string, size: number, digest: string, signal?: AbortSignal) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024) {
    throw new Error("FANTASY_CONTENT_SIZE_INVALID");
  }
  const response = await fetch(url, {credentials: "same-origin", signal});
  if (!response.ok || !response.body) {throw new Error("FANTASY_CONTENT_FETCH_FAILED");}
  const reader = response.body.getReader();
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) {break;}
      if (offset + value.length > size) {throw new Error("FANTASY_CONTENT_SIZE_INVALID");}
      bytes.set(value, offset); offset += value.length;
    }
    await verifyBytes(bytes.subarray(0, offset), size, digest);
    return bytes;
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
