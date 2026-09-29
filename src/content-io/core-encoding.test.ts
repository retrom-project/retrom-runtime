// @vitest-environment node
import {expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {ContentStoreManager} from "./store/manager.js";
import {ContentMaterializer} from "./materializer.js";
it.each([false, true])("fully hashes decoded core bytes before publishing a compressed response (corrupt=%s)", async corrupt => {
  const expected = new Uint8Array([1, 2, 3]), received = corrupt ? new Uint8Array([9, 2, 3]) : expected;
  const object: BlockObject = {key: "a".repeat(64), state: {generation: "test", revoked: false, pinnedEtag: null}, source: {
    identity: {kind: "FILE_SHA256", sha256: createHash("sha256").update(expected).digest("hex")}, sizeBytes: 3,
    url: "https://example.test/core.wasm", purpose: "CORE_ASSET", transport: "WHOLE_ALLOWED", etagPolicy: "NONE_FULL_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}};
  const pool = new BlockPool(0), store = new ContentStoreManager("https://example.test", pool.credits);
  const materializer = new ContentMaterializer(pool, store);
  const response = new Response(received, {headers: {"Content-Encoding": "br", "Content-Length": "7"}});
  Object.defineProperty(response, "url", {value: object.source.url});
  vi.stubGlobal("fetch", vi.fn(async () => response));
  try {
    const pending = materializer.prepare(object, {kind: "BYTES", maxBytes: 3});
    if (corrupt) {await expect(pending).rejects.toThrow("CHECKSUM_MISMATCH"); expect(object.state.revoked).toBe(true);}
    else {expect(await pending).toMatchObject({kind: "BYTES", bytes: expected});}
  } finally {materializer.close(); store.close(); pool.close(); vi.unstubAllGlobals();}
});
