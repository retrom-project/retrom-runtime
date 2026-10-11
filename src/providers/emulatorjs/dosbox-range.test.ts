import {targetContentFixture} from "../../../tests/target-content-fixture.js";
// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {prepareDOSBundle} from "./dosbox-range.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {zipSync} from "fflate";

afterEach(() => vi.unstubAllGlobals());

it.each([
  {indexUrl: "/api/v1/runs/run-id/resources/index/index-id", url: "/api/v1/runs/run-id/resources/resource-id/PC%E5%8E%9F%E4%BA%BA2.zip"},
  {indexUrl: "https://cdn.test/projects/catalog?signature=index", url: "./payload?signature=game"},
])("opens the declared DOS ZIP without depending on Host routes: $indexUrl", async ({indexUrl, url}) => {
  const digest = "a".repeat(64);
  const archive = zipSync({"GAME.EXE": new Uint8Array(1_000_000)}, {level: 0});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files: [{
    path: "game.zip", url, sizeBytes: archive.length, sha256: digest, mediaType: "application/zip",
  }]}))));
  const reads: Array<[number, number]> = [];
  const session = {open: vi.fn(async () => ({abi: "content-io-v1", sizeBytes: archive.length,
    tryReadInto: (offset: number, buffer: Uint8Array) => {
      reads.push([offset, buffer.length]); buffer.set(archive.subarray(offset, offset + buffer.length)); return buffer.byteLength;
    },
    readInto: vi.fn(), close: vi.fn(async () => {}),
  }))} as unknown as ContentSessionClient;
  const bundle = await prepareDOSBundle({indexUrl, contentDigest: digest}, targetContentFixture(session, "dosbox-pure"),
    new AbortController().signal, () => {});
  expect(session.open).toHaveBeenCalledWith(expect.objectContaining({
    identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath: "game.zip"},
    transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", sizeBytes: archive.length,
    url: new URL(url, new URL(indexUrl, location.href)).href,
  }), expect.objectContaining({mode: "RANGE"}), expect.any(AbortSignal));
  expect(reads).toContainEqual([0, 1]);
  expect(reads).toContainEqual([archive.length - 1, 1]);
  expect(reads.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(100_000);
  expect(reads.every(([, length]) => length <= 262144)).toBe(true);
  expect(bundle.range.filename).toBe("game.zip");
  await bundle.range.dispose();
});


it.each([
  {path: "game.zip", url: "/game.zip", sizeBytes: 1024, mediaType: "application/zip"},
  {path: "game.zip", url: "/game.zip", sizeBytes: 1024, sha256: "a".repeat(64)},
  {path: "game.zip", url: "/game.zip", sizeBytes: 1024, sha256: "invalid", mediaType: "application/zip"},
  {path: "../game.zip", url: "/game.zip", sizeBytes: 1024, sha256: "a".repeat(64), mediaType: "application/zip"},
  {path: "game.zip", url: "/game.zip", sizeBytes: 0, sha256: "a".repeat(64), mediaType: "application/zip"},
])("rejects invalid public DOS metadata before opening content", async file => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files: [file]}))));
  const session = {open: vi.fn()} as unknown as ContentSessionClient;
  await expect(prepareDOSBundle({indexUrl: "/api/v1/runs/run-id/resources/index/index-id", contentDigest: "a".repeat(64)},
    targetContentFixture(session, "dosbox-pure"), new AbortController().signal, () => {})).rejects.toThrow("DOSBOX_CONTENT_INDEX_INVALID");
  expect(session.open).not.toHaveBeenCalled();
});
