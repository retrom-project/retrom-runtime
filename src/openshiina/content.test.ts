import {describe, expect, it, vi} from "vitest";
import {createGameFiles} from "./content.js";
import {rangePolicy} from "../provider/content-policies.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
const files = [{path: "SJS_G.WAR", url: "https://content.invalid/g", sizeBytes: 3 * 1024 ** 3, sha256: "a".repeat(64), mediaType: "application/octet-stream"}];
describe("Shiina file service", () => {
  it("opens one lazy bounded reader, preserves large offsets and never materializes an archive", async () => {
    const readInto = vi.fn(async (offset: number, bytes: Uint8Array) => {bytes.fill(offset & 255); return bytes.length;});
    const close = vi.fn(async () => {});
    const reader = {id: "file", readInto, close} as unknown as ContentReaderV1;
    const open = vi.fn(async (_source: unknown) => reader), materialize = vi.fn();
    const session = {open, materialize, inputPolicy: () => rangePolicy("ASYNC", 8 * 1024 ** 3)} as unknown as AdapterContentSession;
    const source = createGameFiles(files, "b".repeat(64), session, "https://host.invalid/");
    expect(open).not.toHaveBeenCalled();
    expect(await source.read("SJS_G.WAR", 2 * 1024 ** 3 + 17, 4)).toEqual(new Uint8Array(4).fill(17));
    await source.read("SJS_G.WAR", 0, 8);
    expect(open).toHaveBeenCalledTimes(1); expect(materialize).not.toHaveBeenCalled();
    expect(open.mock.calls[0][0]).toMatchObject({transport: "RANGE_REQUIRED", identity: {kind: "INDEX_ENTRY", logicalPath: "SJS_G.WAR"}});
    await expect(source.read("SJS_G.WAR", 0, 65537)).rejects.toThrow("SHIINA_RANGE_INVALID");
    await expect(source.read("missing", 0, 1)).rejects.toThrow("SHIINA_RANGE_INVALID");
    await source.close(); expect(close).toHaveBeenCalledTimes(1);
    await expect(source.read("SJS_G.WAR", 0, 1)).rejects.toThrow();
  });
});
