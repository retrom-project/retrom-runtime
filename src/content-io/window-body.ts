import {MAX_FETCH_BYTES} from "./fetch-policy.js";
import {fail} from "./errors.js";
import {integer} from "./source.js";

/** Only bounded network windows may use the native tee's additional buffering. */
export function windowBody(response: Response, expected: number): ReadableStream<Uint8Array> | null {
  if (!integer(expected, 0, MAX_FETCH_BYTES)) {fail("BOUNDS");}
  if (!response.body) {return null;}
  // The browser's HTTP parser enforces Content-Length. Without it, a native
  // tee could eagerly buffer an oversized peer response before JS can reject
  // it. Preserve the strict streaming path for these permitted responses.
  const length = response.headers.get("Content-Length");
  if (length === null || !/^\d+$/u.test(length) || Number(length) !== expected ||
    ![null, "identity"].includes(response.headers.get("Content-Encoding")?.toLowerCase() ?? null)) {return response.body;}
  // A native Response clone drains its source through BeginRead/EndRead. This
  // records transport EOF before closing the JS stream, avoiding Chromium's
  // closed-consumer callback cancelling an otherwise complete request.
  // Cancel the unused branch immediately: retaining it would keep every byte.
  const unused = response.clone();
  void unused.body?.cancel().catch(() => undefined);
  return response.body;
}
