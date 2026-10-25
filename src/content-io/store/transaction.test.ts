// @vitest-environment node
import {expect, it, vi} from "vitest";
import {ContentMetadata} from "./metadata.js";

function fixture() {
  const tx = {error: null as DOMException | null, oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null, onabort: null as (() => void) | null, abort: vi.fn()};
  const metadata = new ContentMetadata({onversionchange: null, transaction: () => tx} as unknown as IDBDatabase);
  return {tx, metadata};
}

it("awaits transaction abort completion after a request error before rejecting storage work", async () => {
  const f = fixture(), failure = new DOMException("delete aborted", "UnknownError");
  let settled = false;
  const operation = f.metadata.transaction(["objects"], "readwrite", (_tx, finish) => finish(undefined))
    .catch(error => error).finally(() => {settled = true;});
  f.tx.error = failure; f.tx.onerror?.(); await Promise.resolve(); await Promise.resolve();
  expect(settled).toBe(false);
  f.tx.onabort!();
  expect(await operation).toMatchObject({code: "CONTENT_IO_CACHE_UNAVAILABLE", cause: failure});
});

it("awaits actual abort after a synchronous storage exception and preserves that original exception", async () => {
  const f = fixture(), failure = new DOMException("bad key", "DataError");
  let settled = false;
  const operation = f.metadata.transaction(["objects"], "readwrite", () => {throw failure;})
    .catch(error => error).finally(() => {settled = true;});
  await Promise.resolve(); await Promise.resolve();
  expect(f.tx.abort).toHaveBeenCalledOnce(); expect(settled).toBe(false);
  f.tx.onabort!(); await expect(operation).resolves.toBe(failure);
});
