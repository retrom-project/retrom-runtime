import {afterEach, expect, it, vi} from "vitest";
import {unzipSync, zipSync} from "fflate";
import type {ContentSessionClient} from "../../content-io/client.js";
import {targetContentFixture} from "../../../tests/target-content-fixture.js";
import {prepareDOSBundle} from "./dosbox-range.js";
import {gbkProgramName, legacyZip} from "../../../tests/zip-encoding-fixture.js";

afterEach(() => vi.unstubAllGlobals());

async function mount(bytes: Uint8Array, entryPath: string | null, close = vi.fn(async () => {})) {
  const reads: Array<[number, number]> = [];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({schemaVersion: 1, files: [{path: "game.zip", url: "/resource.zip",
    sha256: "a".repeat(64), sizeBytes: bytes.length, mediaType: "application/zip"}]})));
  const reader = {abi: "content-io-v1", sizeBytes: bytes.length, close,
    tryReadInto: (offset: number, target: Uint8Array) => {reads.push([offset, target.length]); target.set(bytes.subarray(offset, offset + target.length)); return target.length;},
    readInto: vi.fn()};
  const session = {open: vi.fn(async () => reader)} as unknown as ContentSessionClient;
  const bundle = await prepareDOSBundle({indexUrl: "/resource-index", contentDigest: "b".repeat(64)},
    targetContentFixture(session, "dosbox-pure"), new AbortController().signal, vi.fn(), entryPath);
  return {...bundle, reads, reader};
}

it("projects an explicit nested program into the native AUTOBOOT.DBP without changing the original ZIP bytes", async () => {
  const bytes = zipSync({"PCYR2/pre2.exe": Uint8Array.of(1, 2, 3), "README.TXT": Uint8Array.of(4),
    "autoboot.dbp": new TextEncoder().encode("C:\\OTHER.EXE")}, {level: 0});
  const original = bytes.slice(), {range} = await mount(bytes, "PCYR2/pre2.exe");
  try {
    const projected = await range.read(0, range.sizeBytes);
    const files = unzipSync(projected);
    expect(Array.from(files["PCYR2/pre2.exe"])).toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(files["AUTOBOOT.DBP"])).toBe("C:\\PCYR2\\pre2.exe\r\n");
    expect(Object.keys(files).filter(path => path.toLowerCase() === "autoboot.dbp")).toEqual(["AUTOBOOT.DBP"]);
    expect(Array.from(projected.subarray(0, bytes.length))).toEqual(Array.from(original));
    expect(Array.from(bytes)).toEqual(Array.from(original));
  } finally {await range.dispose();}
});

it("mounts a GBK Chinese directory using a readable selection and a native ASCII boot path", async () => {
  const bytes = legacyZip([{name: gbkProgramName, data: Uint8Array.of(1, 2, 3)}]);
  const {range} = await mount(bytes, "金庸群侠传/PLAY.BAT");
  try {
    const projected = await range.read(0, range.sizeBytes), files = unzipSync(projected);
    const program = Object.keys(files).find(path => path.endsWith("/PLAY.BAT"))!;
    expect(program).toMatch(/^[A-Z0-9]{8}\/PLAY\.BAT$/u);
    expect(new TextDecoder().decode(files["AUTOBOOT.DBP"])).toBe("C:\\" + program.replaceAll("/", "\\") + "\r\n");
    expect(Array.from(files[program])).toEqual([1, 2, 3]);
    expect(Array.from(projected.subarray(0, bytes.length))).toEqual(Array.from(bytes));
  } finally {await range.dispose();}
});

it("normalizes legacy names for the core menu without choosing a program", async () => {
  const bytes = legacyZip([{name: gbkProgramName, data: Uint8Array.of(1)}]);
  const {range} = await mount(bytes, null);
  try {
    const files = unzipSync(await range.read(0, range.sizeBytes));
    expect(Object.keys(files)).toEqual([expect.stringMatching(/^[A-Z0-9]{8}\/PLAY\.BAT$/u)]);
    expect(files["AUTOBOOT.DBP"]).toBeUndefined();
  } finally {await range.dispose();}
});

it("leaves an omitted ASCII entry as the real core menu with bounded metadata inspection", async () => {
  const bytes = zipSync({"a.exe": Uint8Array.of(1), "b.exe": Uint8Array.of(2)}), {range, reads} = await mount(bytes, null);
  try {
    expect(range.sizeBytes).toBe(bytes.length);
    expect(Array.from(await range.read(0, bytes.length))).toEqual(Array.from(bytes));
    expect(reads.every(([, length]) => length <= 262144)).toBe(true);
    expect(unzipSync(await range.read(0, bytes.length))["AUTOBOOT.DBP"]).toBeUndefined();
  }
  finally {await range.dispose();}
});

it("reads only bounded ZIP metadata for a large package, and keeps native reads and disposal bounded", async () => {
  const bytes = zipSync({"nested/game.exe": new Uint8Array(4 * 1024 * 1024)}, {level: 0});
  const {range, reads, reader} = await mount(bytes, "nested/game.exe");
  expect(reads.every(([, length]) => length <= 262144)).toBe(true);
  expect(reads.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(100000);
  const suffix = Array.from(await range.read(bytes.length, range.sizeBytes - bytes.length));
  expect(suffix.length).toBeGreaterThan(0);
  await range.dispose(); expect(reader.close).toHaveBeenCalledOnce();
  await expect(Promise.resolve().then(() => range.read(bytes.length, 1))).rejects.toThrow("CONTENT_IO_ABORTED");
});

it.each(["truncated", "multidisk", "zip64", "directory-offset"] as const)("refuses %s ZIP metadata and closes its original reader", async kind => {
  let bytes = zipSync({"GAME.EXE": Uint8Array.of(1)});
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), end = bytes.length - 22;
  if (kind === "truncated") {bytes = bytes.subarray(0, bytes.length - 1);}
  if (kind === "multidisk") {data.setUint16(end + 4, 1, true);}
  if (kind === "zip64") {data.setUint16(end + 10, 65535, true);}
  if (kind === "directory-offset") {data.setUint32(end + 16, bytes.length, true);}
  const close = vi.fn(async () => {});
  await expect(mount(bytes, "GAME.EXE", close)).rejects.toThrow("DOSBOX_ARCHIVE_INVALID");
  expect(close).toHaveBeenCalledOnce();
});

it("copies reads crossing the original ZIP boundary without aliasing boot metadata", async () => {
  const bytes = zipSync({"GAME.EXE": Uint8Array.of(1)}), {range} = await mount(bytes, "GAME.EXE");
  try {
    const combined = await range.read(bytes.length - 3, 8);
    expect(Array.from(combined.subarray(0, 3))).toEqual(Array.from(bytes.subarray(bytes.length - 3)));
    const original = Array.from(await range.read(bytes.length, 5));
    combined.fill(0);
    expect(Array.from(await range.read(bytes.length, 5))).toEqual(original);
  } finally {await range.dispose();}
});
