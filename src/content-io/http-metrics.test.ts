// @vitest-environment node
import {expect, it, vi} from "vitest";
import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import {fetchRangeBlock, fetchWholeStream} from "./http.js";
import {hashStream} from "./bounded-stream.js";

const source: ContentSourceV1 = {url: "https://example.test/data", sizeBytes: 2, purpose: "CORE_ASSET",
  identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, transport: "WHOLE_ALLOWED",
  etagPolicy: "IMMUTABLE_ASSET", contentLengthPolicy: "EXACT_IF_PRESENT"};
const state = () => ({generation: "one", revoked: false, pinnedEtag: null});
function response(status = 206, bytes = new Uint8Array([1, 2])) {
  const value = new Response(bytes, {status, headers: {"Content-Range": "bytes 0-1/2"}});
  Object.defineProperty(value, "url", {value: source.url}); return value;
}
function observer() {
  const dispatched = vi.fn(), consumed = vi.fn(), wait = vi.fn(async () => {});
  return {dispatched, consumed, wait};
}
it("[IO-24] UNIT/transport-metrics counts dispatched retry attempts and excludes rejected response bodies", async () => {
  const metrics = observer(), fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response(503, new Uint8Array(123))).mockResolvedValueOnce(response());
  await fetchRangeBlock(source, state(), 0, undefined, 15000, {...metrics, fetch});
  expect(metrics.dispatched.mock.calls).toEqual([["RANGE", false], ["RANGE", true]]);
  expect(metrics.consumed.mock.calls).toEqual([[2]]);
});
it("[IO-24] UNIT/transport-metrics counts synchronous fetch failure and terminal authorization denial", async () => {
  const metrics = observer(), fetch = vi.fn<typeof globalThis.fetch>()
    .mockImplementationOnce(() => {throw new TypeError("connection");}).mockResolvedValueOnce(response(403));
  await expect(fetchRangeBlock(source, state(), 0, undefined, 15000, {...metrics, fetch})).rejects.toThrow("AUTHORIZATION_FAILED");
  expect(metrics.dispatched.mock.calls).toEqual([["RANGE", false], ["RANGE", true]]);
  expect(metrics.consumed).not.toHaveBeenCalled();
});
it("[IO-24] UNIT/transport-metrics does not count an aborted retry wait as a second dispatch", async () => {
  const metrics = observer(), abort = new AbortController();
  const wait = async () => {abort.abort();}, fetch = vi.fn(async () => response(503));
  await expect(fetchRangeBlock(source, state(), 0, abort.signal, 15000, {...metrics, fetch, wait})).rejects.toThrow("ABORTED");
  expect(metrics.dispatched.mock.calls).toEqual([["RANGE", false]]); expect(fetch).toHaveBeenCalledOnce();
});
it("[IO-13] UNIT/transport-metrics counts consumed bytes even when a body is oversized", async () => {
  const metrics = observer();
  await expect(fetchRangeBlock(source, state(), 0, undefined, 15000,
    {...metrics, fetch: async () => response(206, new Uint8Array(3))})).rejects.toThrow("LENGTH_MISMATCH");
  expect(metrics.dispatched.mock.calls).toEqual([["RANGE", false]]); expect(metrics.consumed.mock.calls).toEqual([[3]]);
});
it("[IO-20] UNIT/transport-metrics distinguishes whole requests and whole header retries", async () => {
  const metrics = observer(), fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response(429)).mockResolvedValueOnce(response(200));
  expect(await hashStream(fetchWholeStream(source, state(), undefined, {...metrics, fetch}))).toMatchObject({sizeBytes: 2});
  expect(metrics.dispatched.mock.calls).toEqual([["WHOLE", false], ["WHOLE", true]]);
  expect(metrics.consumed.mock.calls).toEqual([[2]]);
});
