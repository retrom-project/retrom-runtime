import {managedAdapterFixture} from "../../tests/managed-adapter-fixture.js";
import {afterEach, expect, it, vi} from "vitest";
import {fetchContent, parseIndex} from "./project.js";
afterEach(() => vi.unstubAllGlobals());
it("materializes indexed bytes through the public session with project/path identity", async () => {
  const fetch = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3))); vi.stubGlobal("fetch", fetch);
  const file = {path: "data/game", url: "https://host/content/hash/game", sizeBytes: 3};
  const content = managedAdapterFixture(file), opened = vi.spyOn(content.contentSession, "open");
  expect(await fetchContent(file, () => undefined, undefined, content.contentSession, "a".repeat(64))).toEqual(Uint8Array.of(1, 2, 3));
  expect(opened.mock.calls[0][0]).toMatchObject({identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: file.path}, etagPolicy: "PIN_STRONG"});
  await expect(fetchContent({...file, sizeBytes: 2}, () => undefined, undefined, content.contentSession, "a".repeat(64))).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");
});
it("rejects unsafe, duplicate, excessive and incomplete project indexes", () => {
  const files = ["Doukutsu.exe", "data/npc.tbl", "data/Stage/Start.pxm", "data/Stage/Start.tsc"]
    .map((path) => ({path, sizeBytes: 1, url: `https://host/content/${path}`}));
  expect(parseIndex({schemaVersion: 1, files})).toEqual(files);
  for (const path of ["../escape", "/escape", "C:/escape", "data/../escape", "data\\escape", "doukutsu.exe"]) {
    expect(() => parseIndex({schemaVersion: 1, files: [...files, {path, sizeBytes: 1, url: "https://host/"}]})).toThrow();
  }
  expect(() => parseIndex({schemaVersion: 1, files: files.slice(1)})).toThrow();
  expect(() => parseIndex({schemaVersion: 1, files: files.map((file) => ({...file, sizeBytes: 64 * 1024 * 1024}))})).toThrow();
});
