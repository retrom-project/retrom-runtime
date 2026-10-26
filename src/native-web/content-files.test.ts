import {afterEach, expect, it, vi} from "vitest";
import {NativeContentFiles} from "./content-files.js";
import {rangePolicy} from "../provider/content-policies.js";
import type {ContentSessionAccess} from "../provider/content-inputs.js";
import type {ProgressContentReader} from "../content-io/range-reader.js";
import {rpgMvEnvelope} from "../../tests/provider-fixtures.js";

const entries = [
  {path: "index.html", sizeBytes: 4, url: "/bytes/index.html", mediaType: "text/html; charset=utf-8"},
  {path: "Audio/雪.ogg", sizeBytes: 8, url: "/bytes/audio", mediaType: "audio/ogg"},
  {path: "data/empty.json", sizeBytes: 0, url: "/bytes/empty", mediaType: "application/json; charset=utf-8"},
];
afterEach(() => vi.unstubAllGlobals());
async function fixture(files: unknown[] = entries, kind: "NATIVE_WEB" | "ISOLATED_WEB" = "NATIVE_WEB") {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files}))));
  const close = vi.fn(async () => {});
  const readInto = vi.fn<ProgressContentReader["readInto"]>(async (_offset, into) => {into.fill(7); return into.length;});
  const session = {open: vi.fn<ContentSessionAccess["open"]>(async () => ({id: "file", abi: "content-io-v1" as const, sizeBytes: 8, close, readInto,
    tryReadInto: () => null, stream: async function* () {yield new Uint8Array(8);}})),
    materialize: vi.fn(), closeFile: vi.fn()} satisfies ContentSessionAccess;
  const content = new NativeContentFiles(session, rangePolicy("ASYNC", 1024));
  const resource = rpgMvEnvelope().resources[0];
  if (resource.kind !== "NATIVE_WEB") {throw new Error("fixture");}
  await content.load({...resource, kind});
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
it("forwards raw network progress for this read without reporting metadata as progress", async () => {
  const {content, readInto} = await fixture();
  readInto.mockImplementation(async (_offset, bytes, _signal, _copied, progress) => {
    progress?.(8192); progress?.(8192); bytes.fill(7); return bytes.length;
  });
  const progress = vi.fn();
  await content.request({type: "STAT", path: "Audio/雪.ogg"}, progress);
  expect(progress).not.toHaveBeenCalled();
  await content.request({type: "READ", path: "Audio/雪.ogg", offset: 0, length: 3}, progress);
  expect(progress.mock.calls).toEqual([[8192], [8192]]);
  await content.close();
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
it.each([
  ["audio/bgm/雪.m4a", "audio/bgm/雪.ogg"],
  ["audio/se/cursor.rpgmvm", "audio/se/cursor.rpgmvo"],
  ["www/audio/me/theme.ogg", "www/audio/me/theme.m4a"],
])("serves the packaged RPG Maker audio for an absent codec variant: %s", async (requested, packaged) => {
  const {content, session} = await fixture([entries[0], {...entries[1], path: packaged}]);
  expect(await content.request({type: "STAT", path: requested})).toMatchObject({status: 200, path: packaged});
  expect((await content.request({type: "READ", path: requested, offset: 0, length: 3})).bytes)
    .toEqual(new Uint8Array([7, 7, 7]));
  expect(session.open.mock.calls[0]?.[0]).toMatchObject({identity: {logicalPath: packaged}});
  await content.close();
});
it("prefers an existing codec and keeps audio aliases within native RPG Maker content", async () => {
  const alternatives = [entries[0], {...entries[1], path: "audio/bgm/theme.ogg"},
    {...entries[1], path: "audio/bgm/theme.m4a"}];
  const {content} = await fixture(alternatives);
  expect(await content.request({type: "STAT", path: "audio/bgm/theme.m4a"}))
    .toMatchObject({status: 200, path: "audio/bgm/theme.m4a"});
  await content.close();
  const isolated = await fixture(alternatives.slice(0, 2), "ISOLATED_WEB");
  expect(await isolated.content.request({type: "STAT", path: "audio/bgm/theme.m4a"})).toEqual({status: 404});
  await isolated.content.close();
  const outside = await fixture([entries[0], {...entries[1], path: "assets/theme.ogg"}]);
  expect(await outside.content.request({type: "STAT", path: "assets/theme.m4a"})).toEqual({status: 404});
  await outside.content.close();
});
it("does not resolve ambiguous codec names through another audio variant", async () => {
  const {content} = await fixture([entries[0], {...entries[1], path: "audio/se/theme.m4a"},
    {...entries[1], path: "audio/se/THEME.M4A"}, {...entries[1], path: "audio/se/theme.ogg"}]);
  expect(await content.request({type: "STAT", path: "audio/se/Theme.m4a"})).toEqual({status: 404});
  await content.close();
});

it("prepares only bounded scenario text through Content I/O for synchronous desktop plugins", async () => {
  const {content, session, readInto} = await fixture([...entries,
    {...entries[1], path: "scenario/En/opening.sl", sizeBytes: 8},
    {...entries[1], path: "scenario/CG.txt", sizeBytes: 8},
    {...entries[1], path: "scenario/movie.ogg", sizeBytes: 8},
    {...entries[1], path: "private.txt", sizeBytes: 8},
  ]);
  const files = await content.prepareRpgPluginFiles();
  expect(files.map(file => file.path)).toEqual(["scenario/En/opening.sl", "scenario/CG.txt"]);
  expect(files[0].data).toEqual(new Uint8Array(8).fill(7).buffer);
  expect(session.open).toHaveBeenCalledTimes(2);
  expect(readInto).toHaveBeenCalledTimes(2);
  await content.close();
});
it("rejects an oversized desktop scenario set before opening any content", async () => {
  const {content, session} = await fixture([...entries, ...Array.from({length: 4097}, (_, n) => ({
    ...entries[1], path: `scenario/${n}.sl`, sizeBytes: 8,
  }))]);
  await expect(content.prepareRpgPluginFiles()).rejects.toThrow("RPG_PLUGIN_FILES_TOO_LARGE");
  expect(session.open).not.toHaveBeenCalled(); await content.close();
});
