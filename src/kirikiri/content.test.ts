import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {KirikiriContent} from "./content.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.restoreAllMocks(); vi.unstubAllGlobals();});
function fixture() {
  const owner = contentSessionFixture("http://localhost"); owners.push(owner);
  const bytes = new Uint8Array([3, 5, 7]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const assetIndex = Object.fromEntries(["vlfs.js", "index.js", "index.wasm", "assets.zip"]
    .map(file => [`assets/kirikiri/${file}`, {sha256, sizeBytes: bytes.length}]));
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers), range = headers.get("Range");
    const response = new Response(bytes, {status: range ? 206 : 200, headers: range
      ? {ETag: '"index-etag"', "Content-Range": "bytes 0-2/3", "Content-Length": "3"} : {}});
    Object.defineProperty(response, "url", {value: url}); return response;
  });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${crypto.randomUUID()}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return {owner, fetcher, assetIndex, content: new KirikiriContent({contentSession: owner.session, assetIndex})};
}
it("[X-27] UNIT/kirikiri verified bytes feed scripts, wasm and resource ZIP without executable refetch", async () => {
  const f = fixture(), assets = await f.content.assets(new URL("http://localhost/core/"));
  expect(assets.archive.size).toBe(3);
  expect(assets.scriptUrl).toMatch(/^blob:/u); expect(assets.vlfsUrl).toMatch(/^blob:/u);
  expect(assets.wasmUrl).toMatch(/^blob:/u);
  const wasmBlob = vi.mocked(URL.createObjectURL).mock.calls[2][0] as Blob;
  expect(wasmBlob.type).toBe("application/wasm");
  expect(new Uint8Array(await wasmBlob.arrayBuffer())).toEqual(new Uint8Array([3, 5, 7]));
  expect(f.fetcher).toHaveBeenCalledTimes(4); expect(f.owner.files.size).toBe(0);
  await f.content.close(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});
it("[X-27] UNIT/kirikiri rejects corrupt executable before script creation", async () => {
  const f = fixture(); f.assetIndex["assets/kirikiri/vlfs.js"].sha256 = "f".repeat(64);
  await expect(f.content.assets(new URL("http://localhost/core/"))).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(URL.createObjectURL).not.toHaveBeenCalled(); await f.content.close();
});
it("[X-09] UNIT/kirikiri file registration is metadata only; independent handles share public blocks and close revokes warm and zero reads", async () => {
  const f = fixture();
  const a = f.content.register("a".repeat(64), "data.xp3", "http://localhost/game/data.xp3", 3);
  const b = f.content.register("a".repeat(64), "data.xp3", "http://localhost/game/data.xp3", 3);
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.owner.files.size).toBe(0);
  const first = new Uint8Array(3); await a.readInto(0, first); await b.readInto(0, new Uint8Array(3));
  expect(f.fetcher).toHaveBeenCalledTimes(1); first.fill(99);
  const cached = new Uint8Array(3); expect(a.tryReadInto(0, cached)).toBe(3); expect(cached).toEqual(new Uint8Array([3, 5, 7]));
  await a.close(); await b.readInto(0, cached); await f.content.close();
  expect(() => b.tryReadInto(3, new Uint8Array())).toThrow("ABORTED");
  await expect(b.readInto(0, cached)).rejects.toThrow("ABORTED");
});
