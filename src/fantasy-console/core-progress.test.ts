import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {deferred} from "../../tests/provider-adapter-fixture.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {loadCore, type FantasyParameters} from "./core.js";
import type {RuntimeLoadProgress} from "../contract.js";

afterEach(() => vi.unstubAllGlobals());
it.each(["tic80", "fake08"] as const)("%s reports all preparation totals before bytes arrive and completes only after verification", async core => {
  const bytes = new Uint8Array([1, 2, 3]), sha256 = createHash("sha256").update(bytes).digest("hex");
  const owner = contentSessionFixture(location.origin), started = deferred<void>(), release = deferred<void>();
  const progress: RuntimeLoadProgress[] = [], loader = vi.fn(async () => {throw new Error("STOP_AFTER_CONTENT");});
  let requests = 0;
  const asset = new Uint8Array([4, 5, 6]), script = new Uint8Array([7, 8, 9]);
  const metadata = (payload: Uint8Array) => ({sha256: createHash("sha256").update(payload).digest("hex"), sizeBytes: payload.length});
  const config: FantasyParameters = {core, cartUrl: "/game/cart", cartSizeBytes: 3, contentDigest: sha256,
    runtimeBaseUrl: "/runtime/", assetIndex: {
      [`assets/${core}/${core}-retrom.wasm`]: metadata(asset),
      [`assets/${core}/${core}-retrom.mjs`]: metadata(script),
    }};
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (++requests === 1) {started.resolve();} await release.promise;
    const payload = url.endsWith("wasm") ? asset : url.endsWith("mjs") ? script : bytes;
    const digest = createHash("sha256").update(payload).digest("hex");
    const response = new Response(payload, {headers: {ETag: `"sha256-${digest}"`}});
    Object.defineProperty(response, "url", {value: url}); return response;
  }));
  const pending = loadCore(config, value => progress.push(value), undefined, loader, owner.session);
  const result = pending.then(() => null, error => error);
  try {
    await started.promise;
    expect(progress).toContainEqual({phase: "PROJECT_CONTENT", loadedBytes: 0, totalBytes: 3});
    expect(progress).toContainEqual({phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes: 6});
    expect(progress.every(row => row.loadedBytes === 0)).toBe(true); expect(loader).not.toHaveBeenCalled();
    release.resolve(); expect(await result).toEqual(new Error("STOP_AFTER_CONTENT"));
    expect(progress.filter(row => row.phase === "PROJECT_CONTENT").at(-1)).toEqual({phase: "PROJECT_CONTENT", loadedBytes: 3, totalBytes: 3});
    expect(progress.filter(row => row.phase === "RUNTIME_ASSET").at(-1)).toEqual({phase: "RUNTIME_ASSET", loadedBytes: 6, totalBytes: 6});
    expect(progress.some(row => row.phase === "RUNTIME_ASSET" && row.loadedBytes === 3)).toBe(true);
  } finally {release.resolve(); await result; await owner.close();}
});
