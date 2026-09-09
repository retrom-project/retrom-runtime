import {createHash} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {fetchFile} from "./files.js";
const bytes = new Uint8Array([1, 2, 3]);
const source = {url: "http://localhost/game.dim", sizeBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex")};
afterEach(() => vi.unstubAllGlobals());
function cacheFixture(initial?: Uint8Array) {
  let stored = initial;
  const remove = vi.fn(async () => {stored = undefined; return true;});
  vi.stubGlobal("caches", {open: async () => ({match: async () => stored ? new Response(Uint8Array.from(stored)) : undefined,
    put: async (_url: string, response: Response) => {stored = new Uint8Array(await response.arrayBuffer());}, delete: remove})});
  return remove;
}
it("verifies and reuses content across runtime instances", async () => {
  cacheFixture(); const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetcher);
  expect(await fetchFile(source, () => undefined)).toEqual(bytes);
  expect(await fetchFile(source, () => undefined)).toEqual(bytes);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("evicts corrupt cache bytes and verifies the replacement", async () => {
  const remove = cacheFixture(new Uint8Array([9, 8, 7]));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  expect(await fetchFile(source, () => undefined)).toEqual(bytes); expect(remove).toHaveBeenCalledOnce();
});
it.each([new Uint8Array([1]), new Uint8Array([1, 2, 3, 4]), new Uint8Array([3, 2, 1])])(
  "rejects truncated, oversized or mismatched network content", async value => {
    cacheFixture(); vi.stubGlobal("fetch", vi.fn(async () => new Response(value)));
    await expect(fetchFile(source, () => undefined)).rejects.toThrow("PX68K_FILE_INVALID");
  });
it("honors cancellation even when the content is cached", async () => {
  cacheFixture(bytes); const controller = new AbortController(); controller.abort();
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(fetchFile(source, () => undefined, controller.signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
