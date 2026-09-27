// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {prepareDOSBundle} from "./dosbox-range.js";
import type {ContentSessionClient} from "../../content-io/client.js";

afterEach(() => vi.unstubAllGlobals());

it.each([
  {indexUrl: "/runtime/content/game/digest/index.json", url: "/runtime/content/game/digest/game.zip"},
  {indexUrl: "https://cdn.test/projects/catalog?signature=index", url: "./payload?signature=game"},
])("opens the declared DOS ZIP without depending on Host routes: $indexUrl", async ({indexUrl, url}) => {
  const digest = "a".repeat(64);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files: [{
    path: "game.zip", url, sizeBytes: 1_000_000,
  }]}))));
  const reads: number[] = [];
  const session = {open: vi.fn(async () => ({abi: "content-io-v1", sizeBytes: 1_000_000,
    tryReadInto: (offset: number, buffer: Uint8Array) => {reads.push(offset); buffer.fill(1); return buffer.byteLength;},
    readInto: vi.fn(), close: vi.fn(async () => {}),
  }))} as unknown as ContentSessionClient;
  const bundle = await prepareDOSBundle({indexUrl, contentDigest: digest}, session,
    new AbortController().signal, () => {});
  expect(session.open).toHaveBeenCalledWith(expect.objectContaining({
    identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath: "game.zip"},
    transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", sizeBytes: 1_000_000,
    url: new URL(url, new URL(indexUrl, location.href)).href,
  }), expect.objectContaining({mode: "RANGE"}), expect.any(AbortSignal));
  expect(reads).toEqual([0, 999_999]);
  expect(bundle.range.filename).toBe("game.zip");
  await bundle.range.dispose();
});
