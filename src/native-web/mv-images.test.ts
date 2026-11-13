import {afterEach, expect, it, vi} from "vitest";
import {NativeContentFiles} from "./content-files.js";
import {rangePolicy} from "../provider/content-policies.js";
import type {ContentSessionAccess} from "../provider/content-inputs.js";
import {rpgMvEnvelope} from "../../tests/provider-fixtures.js";

afterEach(() => vi.unstubAllGlobals());
const key = Uint8Array.from({length: 16}, (_, i) => i + 1);
const png = new Uint8Array(48).map((_, i) => i);
png.set([137, 80, 78, 71, 13, 10, 26, 10]);
const header = new Uint8Array([82, 80, 71, 77, 86, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]);
function encrypted() {
  const bytes = new Uint8Array(16 + png.length); bytes.set(header); bytes.set(png, 16);
  for (let i = 0; i < 16; i++) {bytes[16 + i] ^= key[i]!;}
  return bytes;
}
async function fixture(options: {mv?: boolean; plain?: boolean; corrupt?: boolean; encrypted?: boolean} = {}) {
  const image = encrypted(); if (options.corrupt) {image[0] = 0;}
  const data = new Map([
    ["www/index.html", new TextEncoder().encode("game")],
    ["www/data/System.json", new TextEncoder().encode(JSON.stringify({hasEncryptedImages: options.encrypted ?? true,
      encryptionKey: [...key].map(byte => byte.toString(16).padStart(2, "0")).join("")}))],
    ["www/img/system/Gauge.rpgmvp", image],
  ]);
  if (options.plain) {data.set("www/img/system/Gauge.png", png);}
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1,
    files: [...data].map(([path, bytes]) => ({path, sizeBytes: bytes.length, url: "/bytes/" + encodeURIComponent(path),
      mediaType: "application/octet-stream"})),
  }))));
  const reads: Array<{path: string; offset: number; length: number}> = [];
  const closes: string[] = [];
  const session = {open: vi.fn<ContentSessionAccess["open"]>(async source => {
    if (source.identity.kind !== "INDEX_ENTRY") {throw new Error("fixture");}
    const path = source.identity.logicalPath, bytes = data.get(path)!;
    return {abi: "content-io-v1", id: path, sizeBytes: bytes.length,
      close: async () => {closes.push(path);}, tryReadInto: () => null,
      stream: async function* () {yield bytes;},
      readInto: async (offset, into) => {reads.push({path, offset, length: into.length}); into.set(bytes.subarray(offset, offset + into.length)); return into.length;}};
  }), materialize: vi.fn(), closeFile: vi.fn()} satisfies ContentSessionAccess;
  const content = new NativeContentFiles(session, rangePolicy("ASYNC", 1024));
  const resource = rpgMvEnvelope().resources[0];
  if (resource.kind !== "NATIVE_WEB") {throw new Error("fixture");}
  await content.load({...resource, entryFile: "www/index.html"}, options.mv ?? true);
  return {content, session, reads, closes};
}

it("serves a plugin's early PNG request from the packaged encrypted MV image with bounded reads", async () => {
  const {content, session, reads, closes} = await fixture();
  const path = "www/img/system/gauge.png";
  expect(await content.request({type: "STAT", path})).toMatchObject({status: 200, sizeBytes: png.length, mediaType: "image/png"});
  expect((await content.request({type: "READ", path, offset: 4, length: 20})).bytes).toEqual(png.slice(4, 24));
  expect((await content.request({type: "READ", path, offset: 20, length: 8})).bytes).toEqual(png.slice(20, 28));
  expect(reads.filter(read => read.path.endsWith("rpgmvp"))).toEqual([
    {path: "www/img/system/Gauge.rpgmvp", offset: 0, length: 32},
    {path: "www/img/system/Gauge.rpgmvp", offset: 20, length: 20},
    {path: "www/img/system/Gauge.rpgmvp", offset: 36, length: 8},
  ]);
  expect(session.open.mock.calls.every(([source]) => !source.url.endsWith("Gauge.png"))).toBe(true);
  await expect(content.request({type: "READ", path, offset: png.length - 1, length: 2})).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  await content.close(); expect(closes).toHaveLength(2);
});

it("keeps raw encrypted requests unchanged and prefers an existing PNG", async () => {
  const {content} = await fixture({plain: true});
  expect((await content.request({type: "READ", path: "www/img/system/Gauge.png", offset: 0, length: png.length})).bytes).toEqual(png);
  expect((await content.request({type: "READ", path: "www/img/system/Gauge.rpgmvp", offset: 0, length: 16})).bytes).toEqual(header);
  await content.close();
});

it.each([{mv: false}, {encrypted: false}])("keeps image aliases restricted to encrypted MV projects: %o", async options => {
  const {content} = await fixture(options);
  expect(await content.request({type: "STAT", path: "www/img/system/Gauge.png"})).toEqual({status: 404});
  await content.close();
});

it("rejects a damaged encrypted header before returning image bytes", async () => {
  const {content} = await fixture({corrupt: true});
  await expect(content.request({type: "READ", path: "www/img/system/Gauge.png", offset: 0, length: 8})).rejects.toThrow("CONTENT_IO_SOURCE_INVALID");
  await content.close();
});
