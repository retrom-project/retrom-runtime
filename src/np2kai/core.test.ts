import {afterEach, expect, it, vi} from "vitest";
import {loadCore} from "./core.js";
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();});
it("resolves provider asset paths against the frame document before loading the core", async () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow!;
  expect(win.location.href).toBe("about:blank");
  const bytes = new Uint8Array([1]), sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), v => v.toString(16).padStart(2, "0")).join("");
  const assetIndex = Object.fromEntries(["np2kai.mjs", "np2kai.wasm", "np2kai-register.mjs", "font.bmp"].map(name => [`assets/np2kai/${name}`, {sha256, sizeBytes: 1}]));
  const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetcher);
  vi.spyOn(win.document.head, "append").mockImplementation((...nodes) => {
    const script = nodes[0] as HTMLScriptElement;
    expect(script.src).toBe(new URL("/provider/assets/np2kai/np2kai-register.mjs", location.href).href);
    queueMicrotask(() => script.dispatchEvent(new Event("error")));
  });
  await expect(loadCore({runtimeBaseUrl: "/provider/assets/np2kai/", assetIndex}, win, win.document.createElement("canvas")))
    .rejects.toThrow("NP2KAI_MODULE_LOAD_FAILED");
  expect(fetcher).toHaveBeenCalledTimes(4);
});
