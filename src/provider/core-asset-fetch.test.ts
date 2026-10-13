import {afterEach, expect, it, vi} from "vitest";
import {installCoreAssetFetch} from "./core-asset-fetch.js";
import {loadCoreAsset} from "./core-assets.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
vi.mock("./core-assets.js", () => ({loadCoreAsset: vi.fn()}));
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();});
it("routes only declared core GETs through verified content and preserves ordinary requests", async () => {
  const owner = contentSessionFixture(location.origin), frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow!, original = vi.fn(async () => new Response("network")); win.fetch = original;
  vi.mocked(loadCoreAsset).mockResolvedValue(new Uint8Array([0, 97, 115, 109]));
  const stop = installCoreAssetFetch(win, {contentSession: owner.session,
    assetIndex: {"assets/core.wasm": {sizeBytes: 4, sha256: "a".repeat(64)}}}, "/provider/");
  try {
    const response = await win.fetch("/provider/assets/core.wasm");
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
    expect(loadCoreAsset).toHaveBeenCalledTimes(1); expect(original).not.toHaveBeenCalled();
    for (const input of ["/game/rom", "/provider/unknown.wasm", "https://other.test/provider/assets/core.wasm"]) {await win.fetch(input);}
    await win.fetch("/provider/assets/core.wasm", {method: "POST"});
    await win.fetch("/provider/assets/core.wasm", {headers: {Range: "bytes=0-1"}});
    expect(original).toHaveBeenCalledTimes(5);
    expect(loadCoreAsset).toHaveBeenCalledTimes(1);
  } finally {stop(); await owner.close();}
  expect(win.fetch).toBe(original);
});
