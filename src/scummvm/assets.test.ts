import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {coreAssets} from "./assets.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.unstubAllGlobals();});
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const bytes = new Uint8Array([7, 8, 9]), hash = digest(bytes);
  const files = ["scummvm.wasm", "plugins/libsky.so", "data/encoding.dat"].map(path => ({path, sizeBytes: bytes.length, sha256: hash}));
  const manifest = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, adapterAbi: "scummvm-host-v1", upstreamCommit: "b".repeat(40), engines: {sky: "plugins/libsky.so"}, files}));
  const assetIndex = Object.fromEntries(files.map(file => [`assets/scummvm/${file.path}`, {sha256: file.sha256, sizeBytes: file.sizeBytes}]));
  assetIndex["assets/scummvm/manifest.json"] = {sha256: digest(manifest), sizeBytes: manifest.length};
  const fetcher = vi.fn(async (url: string) => {const response = new Response(url.endsWith("manifest.json") ? manifest : bytes); Object.defineProperty(response, "url", {value: url}); return response;});
  vi.stubGlobal("fetch", fetcher);
  const owner = contentSessionFixture("http://localhost"); owners.push(owner);
  return {content: {contentSession: owner.session, assetIndex}, fetcher};
}
it("[X-27] UNIT/scummvm-manifest refuses a manifest not authenticated by Provider AssetIndex", async () => {
  const f = fixture(); f.content.assetIndex["assets/scummvm/manifest.json"].sha256 = "f".repeat(64);
  await expect(coreAssets("http://localhost/core/", "sky", f.content, new AbortController().signal, vi.fn())).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it("[X-27] UNIT/scummvm-catalog refuses a valid manifest whose engine digest differs from Provider catalog", async () => {
  const f = fixture(); f.content.assetIndex["assets/scummvm/plugins/libsky.so"].sha256 = "f".repeat(64);
  await expect(coreAssets("http://localhost/core/", "sky", f.content, new AbortController().signal, vi.fn())).rejects.toThrow("SCUMMVM_CORE_MANIFEST_INVALID");
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it("[X-27] UNIT/scummvm-executable rejects equal-size corrupted wasm before handing bytes to the core", async () => {
  const f = fixture(), original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async url => {
    if (!url.endsWith("scummvm.wasm")) {return original(url);}
    const response = new Response(new Uint8Array([9, 8, 7])); Object.defineProperty(response, "url", {value: url}); return response;
  });
  await expect(coreAssets("http://localhost/core/", "sky", f.content, new AbortController().signal, vi.fn())).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(f.fetcher.mock.calls.map(([url]) => url)).not.toContain("http://localhost/core/plugins/libsky.so");
});
it("[X-27] UNIT/scummvm-plugin rejects an equal-size corrupted executable plugin after valid wasm", async () => {
  const f = fixture(), original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async url => {
    if (!url.endsWith("plugins/libsky.so")) {return original(url);}
    const response = new Response(new Uint8Array([7, 8, 0])); Object.defineProperty(response, "url", {value: url}); return response;
  });
  await expect(coreAssets("http://localhost/core/", "sky", f.content, new AbortController().signal, vi.fn())).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([
    "http://localhost/core/manifest.json", "http://localhost/core/scummvm.wasm", "http://localhost/core/plugins/libsky.so",
  ]);
});
