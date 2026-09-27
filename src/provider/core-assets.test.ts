import {contentSessionFixture} from "../../tests/content-session-fixture.js";
// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {loadCoreAsset} from "./core-assets.js";
const load = (file: typeof source, signal?: AbortSignal, session?: ReturnType<typeof contentSessionFixture>["session"]) => {
  if (!session) {const owner = contentSessionFixture("https://retrom.test"); owners.push(owner); session = owner.session;}
  return loadCoreAsset({contentSession: session, assetIndex: {"core.wasm": file}}, file.url, "core.wasm", 128 * 1024 * 1024, signal);
};
const bytes = new Uint8Array([1, 2, 3]);
const source = {url: "https://retrom.test/core.wasm", sizeBytes: 3,
  sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"};
const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.unstubAllGlobals();});
it("verifies complete executable assets and rejects truncation, overflow and digest mismatch", async () => {
  vi.stubGlobal("fetch", async () => {const response = new Response(bytes); Object.defineProperty(response, "url", {value: source.url}); return response;});
  const make = () => {const owner = contentSessionFixture("https://retrom.test"); owners.push(owner); return owner.session;};
  await expect(load(source, undefined, make())).resolves.toEqual(bytes);
  for (const bad of [{...source, sizeBytes: 4}, {...source, sizeBytes: 2}, {...source, sha256: "f".repeat(64)}]) {
    await expect(load(bad, undefined, make())).rejects.toThrow(/CONTENT_IO_(LENGTH_MISMATCH|CHECKSUM_MISMATCH)/u);
  }
});
it("does not fetch after cancellation or with invalid asset bounds", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const abort = new AbortController(); abort.abort();
  await expect(load(source, abort.signal)).rejects.toThrow();
  await expect(load({...source, sizeBytes: 128 * 1024 * 1024 + 1})).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  expect(fetcher).not.toHaveBeenCalled();
});
