// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {zipSync} from "fflate";
import {contentSessionFixture} from "../../../tests/content-session-fixture.js";
import {prepareDaphneAssets} from "./daphne-project.js";

const path = "assets/release/data/cores/daphne-resources.zip";
const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.unstubAllGlobals();});
function fixture(bytes: Uint8Array) {
  const owner = contentSessionFixture(location.origin); owners.push(owner);
  return {contentSession: owner.session, assetIndex: {[path]: {
    sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  }}};
}
function archive(value = 1) {
  return zipSync(Object.fromEntries(Array.from({length: 20}, (_, i) => [`pics/led${i}.bmp`, Uint8Array.of(value)])));
}
it("rejects a valid archive whose bytes do not match the Provider asset index", async () => {
  const expected = archive(), corrupt = archive(2), content = fixture(expected);
  vi.stubGlobal("fetch", async (url: string) => {
    const response = new Response(corrupt); Object.defineProperty(response, "url", {value: url}); return response;
  });
  await expect(prepareDaphneAssets(location.origin + "/provider/", new AbortController().signal, content, path))
    .rejects.toThrow("CONTENT_IO_CHECKSUM_MISMATCH");
});
it("rejects an oversized declaration before acquiring any resource bytes", async () => {
  const content = fixture(archive()); content.assetIndex[path].sizeBytes = 8 * 1024 * 1024 + 1;
  const fetcher = vi.fn(async () => new Response(archive())); vi.stubGlobal("fetch", fetcher);
  await expect(prepareDaphneAssets(location.origin + "/provider/", new AbortController().signal, content, path))
    .rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
