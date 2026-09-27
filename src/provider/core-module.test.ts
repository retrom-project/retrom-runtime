// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {loadCoreModule} from "./core-module.js";
import {loadCoreAsset} from "./core-assets.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
vi.mock("./core-assets.js", () => ({loadCoreAsset: vi.fn()}));
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();});
it.each(["asset", "abort", "script"])("releases every verified URL on %s failure", async failure => {
  const owner = contentSessionFixture(location.origin), controller = new AbortController();
  const frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow!;
  const revoke = vi.fn(); let sequence = 0;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() {return `blob:http://localhost/${++sequence}`;}
    static revokeObjectURL = revoke;
  });
  vi.mocked(loadCoreAsset).mockReset().mockResolvedValue(new Uint8Array([1]));
  if (failure === "asset") {vi.mocked(loadCoreAsset).mockResolvedValueOnce(new Uint8Array([1])).mockRejectedValueOnce(new Error("bad digest"));}
  const append = vi.spyOn(win.document.head, "append").mockImplementation((...nodes) => {
    const script = nodes[0] as HTMLScriptElement;
    expect(script.src).toMatch(/^blob:/u);
    queueMicrotask(() => failure === "abort" ? controller.abort() : script.dispatchEvent(new Event("error")));
  });
  try {
    await expect(loadCoreModule({content: {contentSession: owner.session, assetIndex: {
      "assets/a.js": {sizeBytes: 1, sha256: "a".repeat(64)}, "assets/b.js": {sizeBytes: 1, sha256: "b".repeat(64)}}},
    runtimeBaseURL: "/provider/assets/", assetDirectory: "assets/", maximum: 100,
    files: ["a.js", "b.js"], entry: "b.js", registration: "test", window: win, signal: controller.signal})).rejects.toThrow();
    expect(revoke).toHaveBeenCalledTimes(failure === "asset" ? 1 : 2);
    expect(append).toHaveBeenCalledTimes(failure === "asset" ? 0 : 1);
    expect(win.document.querySelector("script")).toBeNull();
  } finally {await owner.close();}
});
