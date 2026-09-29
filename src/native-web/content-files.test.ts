import {afterEach, expect, it, vi} from "vitest";
import {NativeContentFiles} from "./content-files.js";
import {rangePolicy} from "../provider/content-policies.js";
import type {ContentSessionAccess} from "../provider/content-inputs.js";
import {rpgMvEnvelope} from "../../tests/provider-fixtures.js";

const entries = [
  {path: "index.html", sizeBytes: 4, url: "/bytes/index.html", mediaType: "text/html; charset=utf-8"},
  {path: "Audio/雪.ogg", sizeBytes: 8, url: "/bytes/audio", mediaType: "audio/ogg"},
  {path: "data/empty.json", sizeBytes: 0, url: "/bytes/empty", mediaType: "application/json; charset=utf-8"},
];
afterEach(() => vi.unstubAllGlobals());
async function fixture(files: unknown[] = entries) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files}))));
  const close = vi.fn(async () => {});
  const readInto = vi.fn(async (_offset: number, into: Uint8Array) => {into.fill(7); return into.length;});
  const session = {open: vi.fn<ContentSessionAccess["open"]>(async () => ({id: "file", abi: "content-io-v1" as const, sizeBytes: 8, close, readInto,
    tryReadInto: () => null, stream: async function* () {yield new Uint8Array(8);}})),
    materialize: vi.fn(), closeFile: vi.fn()} satisfies ContentSessionAccess;
  const content = new NativeContentFiles(session, rangePolicy("ASYNC", 1024));
  const resource = rpgMvEnvelope().resources[0];
  if (resource.kind !== "NATIVE_WEB") {throw new Error("fixture");}
  await content.load(resource);
  return {content, session, close, readInto};
}
it("maps exact, NFC and unique ASCII aliases to the same immutable file and closes readers", async () => {
  const {content, session, close} = await fixture();
  expect(await content.request({type: "STAT", path: "audio/雪.ogg"})).toEqual({status: 200, path: "Audio/雪.ogg", sizeBytes: 8, mediaType: "audio/ogg"});
  const result = await content.request({type: "READ", path: "audio/雪.ogg", offset: 2, length: 3});
  expect(result.bytes).toEqual(new Uint8Array([7, 7, 7]));
  await content.request({type: "READ", path: "Audio/雪.ogg", offset: 0, length: 1});
  expect(session.open).toHaveBeenCalledTimes(1);
  expect(session.open.mock.calls[0]?.[0]).toMatchObject({identity: {logicalPath: "Audio/雪.ogg"}, url: new URL("/bytes/audio", location.href).href});
  await content.close(); expect(close).toHaveBeenCalledTimes(1);
  await expect(content.request({type: "STAT", path: "index.html"})).rejects.toThrow("CONTENT_IO_ABORTED");
});
it("rejects traversal, unbounded reads and outside files without requesting their URLs", async () => {
  const {content, session} = await fixture();
  expect(await content.request({type: "STAT", path: "secret.json"})).toEqual({status: 404});
  for (const value of [{type: "STAT", path: "../secret"}, {type: "STAT", path: "https://other.test/a"},
    {type: "READ", path: "Audio/雪.ogg", offset: 0, length: 262145}, {type: "READ", path: "Audio/雪.ogg", offset: 7, length: 2}]) {
    await expect(content.request(value)).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  }
  expect(session.open).not.toHaveBeenCalled(); await content.close();
});
it("validates origin, MIME and file identity before exposing a reader", async () => {
  for (const file of [{...entries[1], url: "https://other.test/file"}, {...entries[1], mediaType: "text/plain\r\nX: y"},
    {...entries[1], sizeBytes: -1}, {...entries[1], path: "../secret"}]) {
    await expect(fixture([entries[0], file])).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  }
});
it("reports empty files and refuses ambiguous ASCII aliases", async () => {
  const {content} = await fixture([...entries, {...entries[1], path: "AUDIO/雪.ogg"}]);
  expect(await content.request({type: "STAT", path: "audio/雪.ogg"})).toEqual({status: 404});
  expect(await content.request({type: "STAT", path: "data/empty.json"})).toMatchObject({status: 200, sizeBytes: 0});
  await content.close();
});
