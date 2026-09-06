import {afterEach, describe, expect, it, vi} from "vitest";
import {installPspAssetCompatibility} from "./psp-assets.js";
const base = "/runtime/providers/emulatorjs/digest/assets/4.3.0-pre/data/";
const originalFetch = window.fetch;
afterEach(() => {window.fetch = originalFetch;});
describe("pinned PSP resource requests", () => {
  it("resolves the hardcoded asset path and report cache buster inside the immutable bundle", async () => {
    const fetch = vi.fn(async () => new Response("ok")); window.fetch = fetch;
    const cleanup = installPspAssetCompatibility(window, base);
    await window.fetch("data/cores/ppsspp-assets.zip");
    expect(fetch).toHaveBeenLastCalledWith(new URL(base + "cores/ppsspp-assets.zip", location.href).href, undefined);
    await window.fetch(base + "cores/reports/ppsspp.json?v=496863");
    expect(fetch).toHaveBeenLastCalledWith(new URL(base + "cores/reports/ppsspp.json", location.href).href, undefined);
    const version = await window.fetch("https://cdn.emulatorjs.org/stable/data/version.json");
    expect(await version.json()).toEqual({version: "4.3.0-pre", current_version: "4.3.0-pre"});
    expect(fetch).toHaveBeenCalledTimes(2);
    cleanup(); expect(window.fetch).toBe(fetch);
  });
  it("preserves unrelated URLs, unsupported query parameters and non-GET requests", async () => {
    const fetch = vi.fn(async () => new Response("ok")); window.fetch = fetch;
    const cleanup = installPspAssetCompatibility(window, base);
    for (const path of ["data/cores/other.zip", "https://example.com/data/cores/ppsspp-assets.zip", base + "cores/reports/ppsspp.json?v=1&other=2"]) {
      await window.fetch(path); expect(fetch).toHaveBeenLastCalledWith(path, undefined);
    }
    const init = {method: "POST"}; await window.fetch("data/cores/ppsspp-assets.zip", init);
    expect(fetch).toHaveBeenLastCalledWith("data/cores/ppsspp-assets.zip", init);
    cleanup();
  });
});
