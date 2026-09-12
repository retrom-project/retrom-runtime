// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {loadPSPFile} from "./content.js";
const bytes = new Uint8Array([1, 2, 3]);
const source = {url: "https://retrom.test/core.wasm", sizeBytes: 3,
  sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"};
afterEach(() => vi.unstubAllGlobals());
it("verifies complete executable assets and rejects truncation, overflow and digest mismatch", async () => {
  vi.stubGlobal("fetch", async () => new Response(bytes));
  await expect(loadPSPFile(source)).resolves.toBeUndefined();
  for (const bad of [{...source, sizeBytes: 4}, {...source, sizeBytes: 2}, {...source, sha256: "f".repeat(64)}]) {
    await expect(loadPSPFile(bad)).rejects.toThrow("PPSSPP_CONTENT_INVALID");
  }
});
it("does not fetch after cancellation or with invalid asset bounds", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const abort = new AbortController(); abort.abort();
  await expect(loadPSPFile(source, abort.signal)).rejects.toThrow();
  await expect(loadPSPFile({...source, sizeBytes: 128 * 1024 * 1024 + 1})).rejects.toThrow("PPSSPP_CONTENT_INVALID");
  expect(fetcher).not.toHaveBeenCalled();
});
