import {managedAdapterFixture} from "../../tests/managed-adapter-fixture.js";
import {createHash, webcrypto} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {fetchSwf} from "./fetch.js";

const bytes = new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0]);
const source = {swfUrl: "https://content.test/game.swf", swfSizeBytes: bytes.length,
  contentDigest: createHash("sha256").update(bytes).digest("hex")};
afterEach(() => vi.unstubAllGlobals());
describe("Ruffle SWF semantics after public materialization", () => {
  it("rejects invalid signatures and excessive declared decompressed sizes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    for (const data of [new Uint8Array(8), new Uint8Array([67, 87, 83, 9, 255, 255, 255, 255])]) {
      vi.stubGlobal("fetch", async () => new Response(data));
      await expect(fetchSwf({...source, contentDigest: createHash("sha256").update(data).digest("hex")}, () => undefined, managedAdapterFixture(source).contentSession))
        .rejects.toThrow("RUFFLE_CONTENT_INVALID");
    }
  });
});
