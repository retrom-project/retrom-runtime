import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import {abortable, checkSignal, delay, requestScope} from "./abort.js";
import {iterateExact, readExact} from "./bounded-stream.js";
import {ContentIOError, fail} from "./errors.js";
import {MAX_FETCH_BYTES} from "./fetch-policy.js";
import {BLOCK_BYTES, integer} from "./source.js";

export type ContentObjectState = {
  pinnedEtag: string | null;
  generation: string;
  revoked: boolean;
  persistPin?: (etag: string) => Promise<void>;
  pinCommit?: Promise<void>;
};
export type HttpDependencies = {fetch: typeof fetch; now: () => number; wait: typeof delay; wallNow: () => number; consumed?: (bytes: number) => void; dispatched?: (kind: "RANGE" | "WHOLE", retry: boolean) => void};
const defaults: HttpDependencies = {fetch: (...args) => globalThis.fetch(...args), now: () => performance.now(), wait: delay, wallNow: () => Date.now()};
export function blockRange(source: ContentSourceV1, blockIndex: number) {
  if (!integer(blockIndex) || source.sizeBytes === 0 || blockIndex > Math.floor((source.sizeBytes - 1) / BLOCK_BYTES)) {fail("BOUNDS");}
  const start = blockIndex * BLOCK_BYTES;
  const length = Math.min(BLOCK_BYTES, source.sizeBytes - start);
  return {start, length, end: start + (length - 1)};
}
export async function fetchRangeBlock(source: ContentSourceV1, state: ContentObjectState, blockIndex: number,
  signal?: AbortSignal, remainingMs = 15000, injected: Partial<HttpDependencies> = {}): Promise<Uint8Array<ArrayBuffer>> {
  return fetchRangeRegion(source, state, blockRange(source, blockIndex), signal, remainingMs, injected);
}
export async function fetchRangeInto(source: ContentSourceV1, state: ContentObjectState, start: number,
  destination: Uint8Array<ArrayBuffer>, signal: AbortSignal, injected: Partial<HttpDependencies> = {}): Promise<void> {
  const length = destination.byteLength;
  if (!integer(start) || start % BLOCK_BYTES !== 0 || !integer(length, 1, MAX_FETCH_BYTES) ||
    start >= source.sizeBytes || length > source.sizeBytes - start ||
    length % BLOCK_BYTES !== 0 && length !== source.sizeBytes - start) {fail("BOUNDS");}
  await fetchRangeRegion(source, state, {start, length, end: start + (length - 1)}, signal, 15000, injected, destination);
}
async function fetchRangeRegion(source: ContentSourceV1, state: ContentObjectState, range: ReturnType<typeof blockRange>,
  signal: AbortSignal | undefined, remainingMs: number, injected: Partial<HttpDependencies>, destination?: Uint8Array<ArrayBuffer>) {
  if (source.etagPolicy === "NONE_FULL_SHA256") {fail("SOURCE_INVALID");}
  remainingMs = Math.min(remainingMs, 15000);
  const generation = state.generation;
  const dependencies = {...defaults, ...injected}, started = dependencies.now();
  const scope = requestScope(signal, Math.min(remainingMs, 15000));
  try {
    for (let attempt = 0; ; attempt++) {
      try {return await rangeAttempt(source, state, generation, range, scope.signal, dependencies, destination, attempt > 0);}
      catch (error) {
        checkSignal(scope.signal);
        if (!(error instanceof ContentIOError) || !error.retryable || attempt >= 1) {throw error;}
        const waitMs = error instanceof RetryResponse ? error.waitMs : 250;
        if (waitMs >= remainingMs - (dependencies.now() - started)) {throw error;}
        await dependencies.wait(waitMs, scope.signal);
      }
    }
  } finally {scope.dispose();}
}
async function rangeAttempt(source: ContentSourceV1, state: ContentObjectState, generation: string,
  range: ReturnType<typeof blockRange>, signal: AbortSignal, dependencies: HttpDependencies, destination?: Uint8Array<ArrayBuffer>, retry = false) {
  validState(state, generation, signal);
  const response = await request(source, state, signal, dependencies, `bytes=${range.start}-${range.end}`, retry);
  let accepted = false;
  try {
    commonHeaders(response, source, signal, dependencies);
    if (response.status !== 206) {fail(response.status === 200 ? "RANGE_UNSUPPORTED" : "RANGE_INVALID");}
    validateRepresentation(response);
    if (response.status === 206) {validateRangeHeader(response.headers.get("Content-Range"), range, source.sizeBytes);}
    await validateEtag(response, source, state);
    validateLength(response, source, range.length);
    const bytes = destination ?? await readExact(response.body, range.length, signal, dependencies.consumed);
    if (destination) {
      let written = 0;
      for await (const chunk of iterateExact(response.body, range.length, signal, undefined, dependencies.consumed)) {
        destination.set(chunk, written); written += chunk.length;
      }
    }
    validState(state, generation, signal);
    accepted = true;
    return bytes;
  } finally {if (!accepted && !response.body?.locked) {void response.body?.cancel().catch(() => undefined);}}
}
export async function* fetchWholeStream(source: ContentSourceV1, state: ContentObjectState, signal?: AbortSignal,
  injected: Partial<HttpDependencies> = {}): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  if (source.transport !== "WHOLE_ALLOWED") {fail("SOURCE_INVALID");}
  const dependencies = {...defaults, ...injected}, generation = state.generation;
  const headersScope = requestScope(signal, 20000);
  let response: Response | undefined;
  try {
    validState(state, generation, headersScope.signal);
    response = await wholeResponse(source, state, headersScope.signal, dependencies);
    headersScope.dispose();
    for await (const chunk of iterateExact(response.body, source.sizeBytes, signal, 20000, dependencies.consumed)) {
      validState(state, generation, signal); yield chunk;
    }
    validState(state, generation, signal);
  } finally {
    headersScope.dispose();
    if (!response?.body?.locked) {void response?.body?.cancel().catch(() => undefined);}
  }
}
async function wholeResponse(source: ContentSourceV1, state: ContentObjectState, signal: AbortSignal, dependencies: HttpDependencies) {
  const started = dependencies.now();
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await request(source, state, signal, dependencies, undefined, attempt > 0);
      commonHeaders(response, source, signal, dependencies);
      if (response.status !== 200) {fail("RANGE_INVALID");}
      validateRepresentation(response);
      await validateEtag(response, source, state);
      validateLength(response, source, source.sizeBytes);
      return response;
    } catch (error) {
      void response?.body?.cancel().catch(() => undefined);
      checkSignal(signal);
      if (!(error instanceof ContentIOError) || !error.retryable || attempt >= 1) {throw error;}
      const waitMs = error instanceof RetryResponse ? error.waitMs : 250;
      if (waitMs >= 20000 - (dependencies.now() - started)) {throw error;}
      await dependencies.wait(waitMs, signal);
    }
  }
}
async function request(source: ContentSourceV1, state: ContentObjectState, signal: AbortSignal, dependencies: HttpDependencies, range?: string, retry = false) {
  checkSignal(signal);
  const headers: Record<string, string> = {};
  if (range) {headers.Range = range;}
  const etag = expectedEtag(source) ?? state.pinnedEtag;
  if (etag) {headers["If-Match"] = etag;}
  try {
    dependencies.dispatched?.(range ? "RANGE" : "WHOLE", retry);
    const pending = dependencies.fetch(source.url, {credentials: "same-origin", redirect: "error", headers, signal,
      cache: source.purpose === "CORE_ASSET" ? "default" : "no-store"});
    void pending.then((response) => {if (signal.aborted) {void response.body?.cancel().catch(() => undefined);}}, () => {});
    return await abortable(pending, signal);
  } catch (cause) {
    checkSignal(signal);
    if (cause instanceof ContentIOError) {throw cause;}
    throw new ContentIOError("NETWORK_FAILED", {cause, retryable: true});
  }
}
function commonHeaders(response: Response, source: ContentSourceV1, signal: AbortSignal, dependencies: HttpDependencies) {
  checkSignal(signal);
  let origin: string;
  try {origin = new URL(response.url).origin;} catch {return fail("SOURCE_INVALID");}
  if (response.redirected || origin !== new URL(source.url).origin) {fail("SOURCE_INVALID");}
  if (response.status === 401 || response.status === 403) {fail("AUTHORIZATION_FAILED");}
  if (response.status === 412) {fail("IDENTITY_CHANGED");}
  if ([408, 429, 502, 503, 504].includes(response.status)) {
    const value = response.headers.get("Retry-After");
    const retry = value === null ? 250 : /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - dependencies.wallNow();
    throw new RetryResponse(Number.isFinite(retry) ? Math.max(250, retry) : 250);
  }
}
class RetryResponse extends ContentIOError {
  constructor(readonly waitMs: number) {super("NETWORK_FAILED", {retryable: true});}
}
function validateRepresentation(response: Response) {
  const encoding = response.headers.get("Content-Encoding");
  if (encoding !== null && encoding.toLowerCase() !== "identity" ||
    response.headers.get("Content-Type")?.toLowerCase().split(";")[0].trim() === "multipart/byteranges") {fail("RANGE_INVALID");}
}
function validateRangeHeader(header: string | null, range: ReturnType<typeof blockRange>, size: number) {
  const match = header === null ? null : /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(header);
  if (!match || !match.slice(1).every((value) => integer(Number(value))) ||
    Number(match[1]) !== range.start || Number(match[2]) !== range.end || Number(match[3]) !== size) {fail("RANGE_INVALID");}
}
function validateLength(response: Response, source: ContentSourceV1, length: number) {
  const value = response.headers.get("Content-Length");
  if (value === null) {if (source.contentLengthPolicy === "REQUIRED_EXACT") {fail("LENGTH_MISMATCH");} return;}
  if (!/^\d+$/u.test(value) || !integer(Number(value)) || Number(value) !== length) {fail("LENGTH_MISMATCH");}
}
function expectedEtag(source: ContentSourceV1): string | null {
  return source.etagPolicy === "EXPECTED_SHA256" && source.identity.kind === "FILE_SHA256" ? `"sha256-${source.identity.sha256}"` : null;
}
export async function validateEtag(response: Response, source: ContentSourceV1, state: ContentObjectState): Promise<void> {
  if (source.etagPolicy === "NONE_FULL_SHA256") {return;}
  const etag = response.headers.get("ETag"), expected = expectedEtag(source);
  if (expected !== null) {if (etag !== expected) {fail("IDENTITY_CHANGED");} return;}
  const strong = etag !== null && /^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(etag);
  if (state.pinnedEtag !== null) {
    if (etag !== state.pinnedEtag || !strong) {fail("IDENTITY_CHANGED");}
    await state.pinCommit;
    if (state.revoked) {fail("IDENTITY_CHANGED");}
    return;
  }
  if (!strong) {if (source.etagPolicy !== "IMMUTABLE_ASSET") {fail("IDENTITY_CHANGED");} return;}
  state.pinnedEtag = etag;
  state.pinCommit = Promise.resolve().then(() => state.persistPin?.(etag)).catch((cause: unknown) => {
    state.revoked = true;
    throw cause instanceof ContentIOError ? cause : new ContentIOError("IDENTITY_CHANGED", {cause});
  });
  await state.pinCommit;
  if (state.pinnedEtag !== etag || state.revoked) {fail("IDENTITY_CHANGED");}
}
function validState(state: ContentObjectState, generation: string, signal?: AbortSignal) {
  checkSignal(signal);
  if (state.revoked || state.generation !== generation) {fail("IDENTITY_CHANGED");}
}
