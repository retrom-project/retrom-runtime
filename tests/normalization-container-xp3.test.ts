// @vitest-environment node
import {expect, it} from "vitest";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {normalizeContent} from "../scripts/runtime-normalize-content.mjs";
import {fixture} from "./normalization-molebox-fixture.js";

function uint64(value: number) {const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes;}
function chunk(tag: string, bytes: Buffer) {return Buffer.concat([Buffer.from(tag), uint64(bytes.length), bytes]);}
function adler32(bytes: Buffer) {
  let a = 1, b = 0;
  for (const value of bytes) {a = (a + value) % 65521; b = (b + a) % 65521;}
  return ((b << 16) | a) >>> 0;
}
function protectedArchive(resources: Buffer[]) {
  const bodies: Buffer[] = [], records: Buffer[] = []; let position = 19;
  for (const [index, bytes] of resources.entries()) {
    const name = Buffer.from(`unit-${index}.txt`, "utf16le"), info = Buffer.alloc(22), segment = Buffer.alloc(28), checksum = Buffer.alloc(4);
    info.writeUInt32LE(0x80000000); info.writeBigUInt64LE(BigInt(bytes.length), 4); info.writeBigUInt64LE(BigInt(bytes.length), 12); info.writeUInt16LE(name.length / 2, 20);
    segment.writeBigUInt64LE(BigInt(position), 4); segment.writeBigUInt64LE(BigInt(bytes.length), 12); segment.writeBigUInt64LE(BigInt(bytes.length), 20);
    checksum.writeUInt32LE(adler32(bytes)); position += bytes.length;
    bodies.push(Buffer.from(bytes.map(value => value ^ 0x67)));
    records.push(chunk("File", Buffer.concat([chunk("info", Buffer.concat([info, name])), chunk("segm", segment), chunk("adlr", checksum)])));
  }
  const index = Buffer.concat(records);
  return Buffer.concat([Buffer.from("5850330d0a200a1a8b6701", "hex"), uint64(position), ...bodies, Buffer.from([0]), uint64(index.length), index]);
}
it("runs a real embedded container through resource normalization in the packaged worker boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "container-xp3-"));
  try {
    const resources = [0, 1, 2].map(index => Buffer.from(`Independent format-only resource ${index}: complete checksum sample.`));
    const archive = protectedArchive(resources), built = fixture({resources: [{name: "data.xp3", bytes: archive}]}), path = join(root, "source");
    await writeFile(path, Buffer.concat([Buffer.from("slice"), built.bytes]));
    const source = {logicalKey: "nested/launcher.exe", name: "launcher.exe", sizeBytes: built.bytes.length,
      sha256: createHash("sha256").update(built.bytes).digest("hex")};
    const outputRoot = join(root, "output"), result = await normalizeContent({platformId: "kirikiri", files: [source], outputRoot,
      locators: {[source.logicalKey]: {path, offset: 5, sizeBytes: source.sizeBytes}}});
    expect(result.normalization).toMatchObject({archiveCount: 2, verifiedEntries: 4,
      formatCounts: {"molebox4-steelbox": 1, "xp3-fixed-xor": 1},
      plugins: [{id: "molebox4-steelbox"}, {id: "kirikiri-cxfilterfs"}]});
    const normalized = result.files.find(file => file.logicalKey === "nested/resources/data.xp3")!;
    expect(normalized.path).toBe(join(outputRoot, normalized.logicalKey));
    const bytes = await readFile(normalized.path!), end = Number(bytes.readBigUInt64LE(11));
    expect(bytes.subarray(19, end)).toEqual(Buffer.concat(resources));
    expect(result.normalization!.plugins[0].outputs.find(file => file.file === normalized.logicalKey)!.sha256)
      .toBe(result.normalization!.plugins[1].sources[0].sha256);
    expect(result.normalization!.plugins[1].outputs[0].sha256).toBe(normalized.sha256);
    expect(await readFile(result.files.find(file => file.logicalKey === source.logicalKey)!.path!)).toEqual(built.bytes);
    expect(await readdir(root)).toEqual(["output", "source"]);
  } finally {await rm(root, {recursive: true, force: true});}
});
