import {afterEach, expect, it, vi} from "vitest";
import {SiglusContent} from "./content.js";
import {contentObjectKey, MAX_READ_BYTES} from "../content-io/source.js";
import {ContentIOError} from "../content-io/errors.js";
import {abi} from "../content-io/identity.js";
import {siglusTarget} from "../providers/retrom-runtime/siglus-declaration.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import type {ContentReaderV1, ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

function fixture(count = 3, blocked?: "OPEN" | "READ") {
  const rows = Array.from({length: count}, (_, i) => ({path: `g00/${i}.g00`, url: `http://localhost/run/first/${i}`,
    sizeBytes: 3, sha256: "a".repeat(64), mediaType: "application/octet-stream"}));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files: rows}))));
  const sources: ContentSourceV1[] = [], readers: ContentReaderV1[] = [];
  const suspend = (signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new ContentIOError("ABORTED")), {once: true});
  });
  const session: AdapterContentSession = {
    preloaded: false, inputPolicy: () => siglusTarget.contentIO.game as ReturnType<AdapterContentSession["inputPolicy"]>,
    open: vi.fn(async (source, _policy, signal) => {
      sources.push(source);
      if (blocked === "OPEN") {await suspend(signal);}
      const reader: ContentReaderV1 = {id: String(readers.length), sizeBytes: source.sizeBytes, abi,
        readInto: vi.fn(async (offset, destination, signal) => {
          if (blocked === "READ") {await suspend(signal);}
          for (let i = 0; i < destination.length; i++) {destination[i] = offset + i;}
          return destination.length;
        }),
        tryReadInto: vi.fn(() => null), close: vi.fn(async () => {}),
        stream: vi.fn(async function* () {yield new Uint8Array();}),
      };
      readers.push(reader); return reader;
    }), closeFile: vi.fn(async () => {}), materialize: vi.fn(),
  };
  const content = new SiglusContent({assetIndex: {}, contentSession: session});
  return {content, session, rows, sources, readers};
}

it("reads only requested ranges through the public reader and preserves identity across Launch URLs", async () => {
  const f = fixture();
  await f.content.project("http://localhost/run/first/index", "a".repeat(64));
  expect(f.session.open).not.toHaveBeenCalled();
  expect(await f.content.read("g00/1.g00", 1, 2)).toEqual(new Uint8Array([1, 2]));
  expect(await f.content.read("g00/1.g00", 0, 1)).toEqual(new Uint8Array([0]));
  expect(f.session.open).toHaveBeenCalledOnce();
  expect(f.sources[0]).toMatchObject({identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "g00/1.g00"},
    transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG"});
  expect(f.session.materialize).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
  const second = fixture();
  second.rows.forEach(row => {row.url = row.url.replace("/first/", "/second/");});
  await second.content.project("http://localhost/run/second/index", "a".repeat(64));
  await second.content.read("g00/1.g00", 1, 2);
  expect(contentObjectKey(second.sources[0]!, location.origin)).toBe(contentObjectKey(f.sources[0]!, location.origin));
  await f.content.close(); await second.content.close();
  expect(f.readers[0]!.close).toHaveBeenCalledOnce();
  expect(second.readers[0]!.close).toHaveBeenCalledOnce();
});

it.each(["OPEN", "READ"] as const)("cancels a pending public %s before releasing its reader", async stage => {
  const f = fixture(1, stage);
  await f.content.project("http://localhost/index", "a".repeat(64));
  const reading = Promise.resolve().then(() => f.content.read("g00/0.g00", 0, 1));
  const failed = expect(reading).rejects.toThrow("CONTENT_IO_ABORTED");
  await vi.waitFor(() => stage === "OPEN" ? expect(f.session.open).toHaveBeenCalledOnce() :
    expect(f.readers[0]?.readInto).toHaveBeenCalledOnce());
  await f.content.close(); await failed;
  for (const reader of f.readers) {expect(reader.close).toHaveBeenCalledOnce();}
});

it("rejects invalid paths and ranges before allocating bytes or opening a reader", async () => {
  const f = fixture(1);
  f.rows[0]!.sizeBytes = 3_000_000_000;
  await f.content.project("http://localhost/index", "a".repeat(64));
  expect(() => f.content.read("missing", 0, 1)).toThrow(ContentIOError);
  expect(() => f.content.read("g00/0.g00", -1, 1)).toThrow(ContentIOError);
  expect(() => f.content.read("g00/0.g00", 0, MAX_READ_BYTES + 1)).toThrow(ContentIOError);
  expect(f.session.open).not.toHaveBeenCalled();
  await f.content.close();
  expect(() => f.content.read("g00/0.g00", 0, 1)).toThrow(ContentIOError);
});

it("keeps a complete preload on the same reader path instead of rematerializing a directory", async () => {
  const f = fixture();
  Object.assign(f.session, {preloaded: true});
  await f.content.project("http://localhost/index", "a".repeat(64));
  expect(f.session.open).not.toHaveBeenCalled();
  expect(await f.content.read("g00/0.g00", 1, 1)).toEqual(new Uint8Array([1]));
  expect(f.session.materialize).not.toHaveBeenCalled();
  await f.content.close();
});

it.each([false, true])("releases all actually opened readers within the RPC limit, including a failed close: %s", async failed => {
  const f = fixture(500);
  let active = 0, peak = 0, attempted = 0;
  const failure = new Error("close failed");
  await f.content.project("http://localhost/index", "a".repeat(64));
  for (const row of f.rows) {await f.content.read(row.path, 0, 1);}
  f.readers.forEach((reader, index) => {
    vi.mocked(reader.close).mockImplementation(async () => {
      attempted++; active++; peak = Math.max(peak, active);
      try {if (failed && index === 3) {throw failure;} await Promise.resolve();} finally {active--;}
    });
  });
  if (failed) {await expect(f.content.close()).rejects.toBe(failure);} else {await f.content.close();}
  expect(attempted).toBe(500); expect(peak).toBeLessThanOrEqual(256);
});
