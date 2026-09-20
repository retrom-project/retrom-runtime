import {abortable, checkSignal, requestScope} from "../content-io/abort.js";
/** Budget preserves the index producer's file-count/path limits, including JSON and URL escaping. */
export function indexByteBudget(maximumFiles: number, maximumPathCodeUnits: number): number {
  const value = Math.max(16 * 1024 * 1024, 65536 + maximumFiles * (18 * maximumPathCodeUnits + 8192));
  if (!Number.isSafeInteger(value) || maximumFiles < 1 || maximumPathCodeUnits < 1) {throw new Error("METADATA_LIMIT_INVALID");}
  return value;
}
export async function boundedJson(response: Response, maximum: number, signal?: AbortSignal): Promise<unknown> {
  if (!response.ok || response.redirected || !response.body) {throw new Error("METADATA_UNAVAILABLE");}
  const header = response.headers.get("Content-Length");
  if (header !== null && (!/^\d+$/u.test(header) || Number(header) > maximum)) {
    await response.body.cancel().catch(() => {}); throw new Error("METADATA_SIZE_INVALID");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", {fatal: true}), chunks: string[] = [];
  let consumed = 0;
  try {
    for (;;) {
      const scope = requestScope(signal, 20000);
      try {
        const part = await abortable(reader.read(), scope.signal); checkSignal(signal); if (part.done) {break;}
        consumed += part.value.byteLength;
        if (consumed > maximum) {throw new Error("METADATA_SIZE_INVALID");}
        chunks.push(decoder.decode(part.value, {stream: true}));
      } finally {scope.dispose();}
    }
    chunks.push(decoder.decode()); return JSON.parse(chunks.join("")) as unknown;
  } finally {void reader.cancel().catch(() => {}); reader.releaseLock();}
}
export async function fetchMetadataJson(url: string | URL, maximum: number, signal?: AbortSignal): Promise<unknown> {
  const scope = requestScope(signal, 20000);
  let response: Response;
  try {response = await abortable(fetch(url, {credentials: "same-origin", redirect: "error", signal: scope.signal}), scope.signal);}
  finally {scope.dispose();}
  return boundedJson(response, maximum, signal);
}
