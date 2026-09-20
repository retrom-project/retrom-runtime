// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {fetchRangeBlock, fetchWholeStream, blockRange, type ContentObjectState} from "./http.js";
import {validateSource} from "./source.js";
import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import {hashStream} from "./bounded-stream.js";
const origin = "https://example.test", sha = "a".repeat(64), etag = `"sha256-${sha}"`;
function source(patch: Partial<ContentSourceV1> = {}): ContentSourceV1 {
  return validateSource({identity: {kind: "FILE_SHA256", sha256: sha}, sizeBytes: 1, url: `${origin}/game`, purpose: "GAME",
    transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT",  ...patch},
  {storageOrigin: origin, allowedOrigins: [origin]});
}
const state = (): ContentObjectState => ({generation: "generation", revoked: false, pinnedEtag: null});
function response(headers: Record<string, string | null | undefined> = {}, status = 206, body: BodyInit | null = new Uint8Array([17])) {
  const combined = new Headers({ETag: etag, "Content-Range": "bytes 0-0/1", "Content-Length": "1"});
  for (const [key, value] of Object.entries(headers)) {if (value === null || value === undefined) {combined.delete(key);} else {combined.set(key, value);}}
  const result = new Response(body, {status, headers: combined});
  Object.defineProperty(result, "url", {value: `${origin}/game`});
  return result;
}
const read = (result: Response, input = source(), object = state()) => fetchRangeBlock(input, object, 0, undefined, 15000,
  {fetch: async () => result});
afterEach(() => vi.useRealTimers());

it("[IO-14] UNIT/transport rejects missing strong ETag before accepting project bytes", async () => {
  const result = response({ETag: null}), getReader = vi.spyOn(result.body!, "getReader");
  await expect(read(result, source({identity: {kind: "INDEX_ENTRY", projectDigest: sha, logicalPath: "game.dat"}, etagPolicy: "PIN_STRONG"})))
    .rejects.toThrow("CONTENT_IO_IDENTITY_CHANGED");
  expect(getReader).not.toHaveBeenCalled();
});
it("[IO-11] UNIT/transport refuses whole fallback before reading or allocating a whole object", async () => {
  const result = response({}, 200), getReader = vi.spyOn(result.body!, "getReader"), cancel = vi.spyOn(result.body!, "cancel");
  await expect(read(result)).rejects.toThrow("CONTENT_IO_RANGE_UNSUPPORTED");
  expect(getReader).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
});
it.each(["bytes 1-1/1", "bytes 0-1/1", "bytes 0-0/2", "bytes 0-0/*", "bytes 0-0/1 garbage", "Bytes 0-0/1", "bytes  0-0/1"])(
  "[IO-12] UNIT/transport rejects malformed Content-Range %s", async (value) => {
    await expect(read(response({"Content-Range": value}))).rejects.toThrow("CONTENT_IO_RANGE_INVALID");
  });
it("[IO-13] UNIT/transport [X-03] UNIT/transport rejects short and long bodies and waits for actual EOF", async () => {
  await expect(read(response({}, 206, new Uint8Array()))).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");
  await expect(read(response({}, 206, new Uint8Array([17, 18])))).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new Uint8Array([17]));}, cancel});
  await expect(fetchRangeBlock(source(), state(), 0, undefined, 10, {fetch: async () => response({}, 206, body)})).rejects.toThrow("CONTENT_IO_TIMEOUT");
  expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});
it.each([null, `W/${etag}`, '"changed"'])("[IO-14] UNIT/transport rejects ETag %s", async (value) => {
  await expect(read(response({ETag: value}))).rejects.toThrow("CONTENT_IO_IDENTITY_CHANGED");
});
it("[IO-14] UNIT/transport pins a single INDEX_ENTRY representation across simultaneous first reads", async () => {
  const input = source({identity: {kind: "INDEX_ENTRY", projectDigest: sha, logicalPath: "game.dat"}, etagPolicy: "PIN_STRONG"});
  const object = state();
  const results = await Promise.allSettled([read(response({ETag: '"one"'}), input, object), read(response({ETag: '"two"'}), input, object)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ETag: '"one"'}));
  await fetchRangeBlock(input, object, 0, undefined, 15000, {fetch});
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({headers: {"If-Match": '"one"'}});
});
it("[IO-15] UNIT/transport enforces exact Content-Length only when the profile requires it", async () => {
  expect(await read(response({"Content-Length": null}))).toEqual(new Uint8Array([17]));
  await expect(read(response({"Content-Length": null}), source({contentLengthPolicy: "REQUIRED_EXACT"}))).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");
  for (const value of ["", "2", "1, 1", "-1", "1e0", "9007199254740992"]) {
    await expect(read(response({"Content-Length": value}))).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");
  }
});
it("[IO-16] UNIT/transport [X-02] UNIT/transport rejects 416, multipart, compressed and redirected representations", async () => {
  await expect(read(response({}, 416))).rejects.toThrow("CONTENT_IO_RANGE_INVALID");
  for (const headers of [{"Content-Type": "multipart/byteranges; boundary=x"}, {"Content-Encoding": "gzip"}]) {
    await expect(read(response(headers))).rejects.toThrow("CONTENT_IO_RANGE_INVALID");
  }
  const redirected = response(); Object.defineProperty(redirected, "redirected", {value: true});
  await expect(read(redirected)).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
});
it("[IO-17] UNIT/transport rejects unplanned 200 responses regardless of file size", async () => {
  await expect(read(response({}, 200), source())).rejects.toThrow("CONTENT_IO_RANGE_UNSUPPORTED");
  await expect(read(response({}, 200), source({sizeBytes: 262145, }))).rejects.toThrow("CONTENT_IO_RANGE_UNSUPPORTED");
});
it("[IO-20] UNIT/transport streams whole files within the declared byte length", async () => {
  const stream = fetchWholeStream(source({transport: "WHOLE_ALLOWED"}), state(), undefined, {fetch: async () => response({}, 200)});
  expect(await hashStream(stream)).toMatchObject({sizeBytes: 1});
  await expect(hashStream(fetchWholeStream(source(), state()))).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  for (const status of [206, 204, 304]) {
    await expect(hashStream(fetchWholeStream(source({transport: "WHOLE_ALLOWED"}), state(), undefined,
      {fetch: async () => response({}, status, status === 206 ? new Uint8Array([17]) : null)}))).rejects.toThrow("CONTENT_IO_RANGE_INVALID");
  }
});
it("[IO-21] UNIT/transport keeps project pins separate from expected file hashes", async () => {
  const input = source({identity: {kind: "INDEX_ENTRY", projectDigest: sha, logicalPath: "game.dat"}, etagPolicy: "PIN_STRONG"});
  const object = state();
  expect(await read(response({ETag: '"opaque-server-revision"'}), input, object)).toEqual(new Uint8Array([17]));
  expect(object.pinnedEtag).toBe('"opaque-server-revision"');
});
it("[IO-24] UNIT/transport retries temporary failures at most once within the original budget", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response());
  let now = 0;
  const wait = vi.fn(async (ms: number) => {now += ms;});
  await fetchRangeBlock(source(), state(), 0, undefined, 1000, {fetch, now: () => now, wait});
  expect(fetch).toHaveBeenCalledTimes(2); expect(wait.mock.calls[0][0]).toBe(250);
  const failFetch = vi.fn(async () => response({}, 503));
  await expect(fetchRangeBlock(source(), state(), 0, undefined, 1000, {fetch: failFetch, now: () => now, wait})).rejects.toThrow("CONTENT_IO_NETWORK_FAILED");
  expect(failFetch).toHaveBeenCalledTimes(2);
  const delayed = vi.fn(async () => response({"Retry-After": "10"}, 429));
  await expect(fetchRangeBlock(source(), state(), 0, undefined, 1000, {fetch: delayed, now: () => now, wait})).rejects.toThrow("CONTENT_IO_NETWORK_FAILED");
  expect(delayed).toHaveBeenCalledOnce();
});
it("rejects failed headers without reading a response body", async () => {
  for (const [status, error] of [[401, "AUTHORIZATION_FAILED"], [403, "AUTHORIZATION_FAILED"], [412, "IDENTITY_CHANGED"]] as const) {
    const result = response({}, status), reader = vi.spyOn(result.body!, "getReader");
    await expect(read(result)).rejects.toThrow(`CONTENT_IO_${error}`); expect(reader).not.toHaveBeenCalled();
  }
});
it("binds same-origin credentials, no redirect and conditional identity headers", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
  await fetchRangeBlock(source(), state(), 0, undefined, 15000, {fetch});
  expect(fetch.mock.calls[0]).toEqual([`${origin}/game`, expect.objectContaining({credentials: "same-origin", redirect: "error", cache: "no-store",
    headers: {Range: "bytes=0-0", "If-Match": etag}})]);
});
it("[X-27] UNIT/stage-S03 [X-01] UNIT/transport permits only immutable data assets without ETags, while executable assets are whole-only", async () => {
  const data = source({purpose: "CORE_ASSET", etagPolicy: "IMMUTABLE_ASSET"});
  expect(await read(response({ETag: null}), data)).toEqual(new Uint8Array([17]));
  const object = state(); await read(response({ETag: '"ordinary-strong-etag"'}), data, object);
  await expect(read(response({ETag: null}), data, object)).rejects.toThrow("CONTENT_IO_IDENTITY_CHANGED");
  const executable = source({purpose: "CORE_ASSET", etagPolicy: "NONE_FULL_SHA256", transport: "WHOLE_ALLOWED"});
  await expect(read(response(), executable)).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  expect(await hashStream(fetchWholeStream(executable, state(), undefined, {fetch: async () => response({ETag: null}, 200)}))).toMatchObject({sizeBytes: 1});
});
it("[X-30] UNIT/stage-S03 calculates the MAX_SAFE_INTEGER tail without overflowing an intermediate addition", () => {
  const range = blockRange(source({sizeBytes: Number.MAX_SAFE_INTEGER}), 34359738367);
  expect(range).toEqual({start: 9007199254478848, end: 9007199254740990, length: 262143});
});
it("[IO-14] UNIT/transport withholds every first reader until the persistent ETag CAS completes", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {release = resolve;});
  const input = source({identity: {kind: "INDEX_ENTRY", projectDigest: sha, logicalPath: "game.dat"}, etagPolicy: "PIN_STRONG"});
  const object = {...state(), persistPin: () => barrier};
  const a = response({ETag: '"same"'}), b = response({ETag: '"same"'});
  const firstReader = vi.spyOn(a.body!, "getReader"), secondReader = vi.spyOn(b.body!, "getReader");
  const first = read(a, input, object), second = read(b, input, object);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(firstReader).not.toHaveBeenCalled(); expect(secondReader).not.toHaveBeenCalled();
  release(); expect(await Promise.all([first, second])).toHaveLength(2);
});
it("[IO-24] UNIT/transport retries whole headers without replaying a partial body", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response({}, 429)).mockResolvedValueOnce(response({}, 200));
  await expect(hashStream(fetchWholeStream(source({transport: "WHOLE_ALLOWED"}), state(), undefined,
    {fetch, wait: async () => {}}))).resolves.toMatchObject({sizeBytes: 1});
  expect(fetch).toHaveBeenCalledTimes(2);
});
