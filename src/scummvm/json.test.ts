import {afterEach, expect, it, vi} from "vitest";
import {scummvmJson} from "./json.js";

afterEach(() => {vi.unstubAllGlobals();});
it("bounds actual JSON bytes even if the server omits or lies about content length", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('"' + "x".repeat(64) + '"', {headers: {"content-length": "1"}})));
  await expect(scummvmJson("https://example.test/index", 32, new AbortController().signal, "SCUMMVM_INDEX_INVALID"))
    .rejects.toThrow("SCUMMVM_INDEX_INVALID");
});
it("decodes valid bounded UTF-8 JSON and rejects invalid UTF-8", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"schemaVersion":1}')));
  await expect(scummvmJson("https://example.test/index", 32, new AbortController().signal, "SCUMMVM_INDEX_INVALID"))
    .resolves.toEqual({schemaVersion: 1});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(Uint8Array.of(34, 255, 34))));
  await expect(scummvmJson("https://example.test/index", 32, new AbortController().signal, "SCUMMVM_INDEX_INVALID"))
    .rejects.toThrow("SCUMMVM_INDEX_INVALID");
});
