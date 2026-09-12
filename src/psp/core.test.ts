// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {loadPSP} from "./core.js";
import type {AssetIndexV1} from "../provider/module-api.js";
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});
it("verifies PSP WASM assets larger than 8 MiB before registering the core", async () => {
  const small = new Uint8Array([1, 2, 3]), wasm = new Uint8Array(12 * 1024 * 1024);
  const files = ["ppsspp.js", "ppsspp.wasm", "ppsspp.data", "ppsspp.worker.mjs", "ppsspp-host.mjs", "ppsspp-input.mjs", "ppsspp-audio.mjs"];
  const index: Record<string, AssetIndexV1[string]> = {};
  for (const file of files) {
    const bytes = file.endsWith(".wasm") ? wasm : small;
    index[`assets/ppsspp/${file}`] = {sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
  }
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url); return new Response(url.endsWith(".wasm") ? wasm : small);
  });
  const frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow!;
  const registration = {abi: "ppsspp-host-v1", createPPSSPPHost: () => {}};
  Object.assign(win, {__RETROM_PPSSPP_V1__: registration});
  vi.spyOn(win.document.head, "append").mockImplementation((...nodes) => {
    expect(fetched).toHaveLength(7);
    queueMicrotask(() => (nodes[0] as HTMLScriptElement).dispatchEvent(new Event("load")));
  });
  const value = await loadPSP({runtimeBaseUrl: "https://core.test/", assetIndex: index,
    game: {url: "https://game.test/", sizeBytes: 1, sha256: "0".repeat(64)}}, win);
  expect(value).toBe(registration);
});

it("rejects oversized asset declarations before allocating or fetching", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(loadPSP({runtimeBaseUrl: "https://core.test/", game: {url: "https://game.test/", sizeBytes: 1, sha256: "0".repeat(64)},
    assetIndex: {"assets/ppsspp/ppsspp.js": {sizeBytes: 128 * 1024 * 1024 + 1, sha256: "0".repeat(64)}}}, window))
    .rejects.toThrow("PPSSPP_ASSET_SIZE_INVALID");
  expect(fetcher).not.toHaveBeenCalled();
});
