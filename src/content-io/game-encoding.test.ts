// @vitest-environment node
import {expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {ContentStoreManager} from "./store/manager.js";
import {ContentMaterializer} from "./materializer.js";
import {validateSource} from "./source.js";

it.each(["GAME", "FIRMWARE"] as const)("hashes decoded whole %s bytes independently of the encoded ETag and length", async purpose => {
  const expected = Uint8Array.of(1, 2, 3);
  const source = validateSource({identity: {kind: "FILE_SHA256", sha256: createHash("sha256").update(expected).digest("hex")},
    sizeBytes: 3, url: "https://example.test/content", purpose, transport: "WHOLE_ALLOWED",
    etagPolicy: "NONE_FULL_SHA256", contentLengthPolicy: "REQUIRED_EXACT"},
  {storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]});
  for (const corrupt of [false, true]) {
    const object: BlockObject = {key: "a".repeat(64), state: {generation: "test", revoked: false, pinnedEtag: null}, source};
    const pool = new BlockPool(0), store = new ContentStoreManager("https://example.test", pool.credits);
    const materializer = new ContentMaterializer(pool, store);
    const response = new Response(corrupt ? Uint8Array.of(9, 2, 3) : expected,
      {headers: {"Content-Encoding": "gzip", "Content-Length": "23", ETag: 'W/"encoded"'}});
    Object.defineProperty(response, "url", {value: source.url});
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response); vi.stubGlobal("fetch", fetch);
    try {
      const pending = materializer.prepare(object, {kind: "BYTES", maxBytes: 3});
      if (corrupt) {await expect(pending).rejects.toThrow("CHECKSUM_MISMATCH"); expect(object.state.revoked).toBe(true);}
      else {expect(await pending).toMatchObject({kind: "BYTES", bytes: expected, receipt: {assurance: "EXPECTED_SHA256"}});}
      expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty("If-Match");
    } finally {materializer.close(); store.close(); pool.close(); vi.unstubAllGlobals();}
  }
});
