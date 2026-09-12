import {afterEach, expect, it, vi} from "vitest";
import {fetchContent, parseIndex} from "./project.js";
afterEach(() => vi.unstubAllGlobals());
it("reuses exact immutable content across instances and replaces corrupt cached bytes", async () => {
  const stored = new Map<string, Response>();
  vi.stubGlobal("caches", {open: async () => ({match: async (url: string) => stored.get(url)?.clone(),
    put: async (url: string, response: Response) => stored.set(url, response), delete: async (url: string) => stored.delete(url)})});
  const fetch = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3))); vi.stubGlobal("fetch", fetch);
  const file = {url: "https://host/content/hash/game", sizeBytes: 3};
  expect(await fetchContent(file, () => undefined)).toEqual(Uint8Array.of(1, 2, 3));
  expect(await fetchContent(file, () => undefined)).toEqual(Uint8Array.of(1, 2, 3));
  expect(fetch).toHaveBeenCalledTimes(1);
  stored.set(file.url, new Response(Uint8Array.of(1)));
  await fetchContent(file, () => undefined); expect(fetch).toHaveBeenCalledTimes(2);
  await expect(fetchContent({...file, sizeBytes: 2}, () => undefined)).rejects.toThrow("NXENGINE_PROJECT_INVALID");
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
