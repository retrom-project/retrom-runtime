import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, writeFile, readFile, rm, readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {normalizeContent} from "./runtime-normalize-content.mjs";
import {adler32, chunk, magic, resourceBytes, uint64} from "./kirikiri/bytes.mjs";
import {createCxFilter} from "./kirikiri/cxdec.mjs";
import {readXp3} from "./kirikiri/xp3.mjs";
import {fixture, profile} from "../tests/kirikiri-classic-fixture.ts";

function archive(entries, filter) {
  const bodies = [], rows = []; let offset = 19;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf16le"), seed = entry.seed ?? adler32(entry.bytes);
    const body = filter.apply(Buffer.from(entry.bytes), seed), info = Buffer.alloc(22), segment = Buffer.alloc(28), checksum = Buffer.alloc(4);
    info.writeUInt32LE(0x80000000); info.writeBigUInt64LE(BigInt(body.length), 4); info.writeBigUInt64LE(BigInt(body.length), 12);
    info.writeUInt16LE(name.length / 2, 20); segment.writeBigUInt64LE(BigInt(offset), 4);
    segment.writeBigUInt64LE(BigInt(body.length), 12); segment.writeBigUInt64LE(BigInt(body.length), 20); checksum.writeUInt32LE(seed);
    rows.push(chunk("File", Buffer.concat([chunk("info", Buffer.concat([info, name])), chunk("segm", segment), chunk("adlr", checksum)])));
    bodies.push(body); offset += body.length;
  }
  const index = Buffer.concat(rows);
  return Buffer.concat([magic, uint64(offset), ...bodies, Buffer.from([0]), uint64(index.length), index]);
}
async function input(t, defect, reverse = false) {
  const root = await mkdtemp(join(tmpdir(), "native-seed-metadata-")); t.after(() => rm(root, {recursive: true, force: true}));
  const module = fixture(), filter = createCxFilter(profile());
  const entries = Array.from({length: 3}, (_, i) => ({name: `arbitrary-${i}.txt`, bytes: Buffer.from(`Independent resource ${i}: verified text evidence.\r\n`)}));
  const seeded = entries.map((entry, i) => ({...entry, seed: 123 + i * 131}));
  if (defect === "mixed") {delete seeded[2].seed;}
  if (defect === "single-corrupt") {delete seeded[1].seed; delete seeded[2].seed;}
  if (defect === "insufficient") {entries.pop();}
  if (defect === "unsupported") {seeded[2].bytes = Buffer.from([0, 1, 2, 3, 4]);}
  const packages = [["verified.pack", archive(entries, filter)], ["seeded.pack", archive(seeded, filter)]];
  if (reverse) {packages.reverse();}
  packages.push(["arbitrary-reader.dll", module]);
  const files = [], locators = {};
  for (const [name, bytes] of packages) {
    const path = join(root, name); await writeFile(path, bytes);
    files.push({name, logicalKey: name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    locators[name] = {path, offset: 0, sizeBytes: bytes.length};
  }
  return {request: {platformId: "kirikiri", files, locators, outputRoot: join(root, "output")}, seeded};
}
for (const reverse of [false, true]) {
  test(`audits an entirely seed-only native archive with independent checksummed evidence (reverse=${reverse})`, async t => {
    const {request, seeded} = await input(t, null, reverse), source = await readFile(request.locators["seeded.pack"].path);
    const result = await normalizeContent(request);
    assert.equal(result.normalization.verifiedEntries, 3); assert.equal(result.normalization.metadataCorrections, 3);
    const output = result.files.find(file => file.logicalKey === "seeded.pack");
    const locator = {path: output.path, offset: 0, sizeBytes: output.sizeBytes}, decoded = await readXp3(locator, {includePlainEntries: true});
    for (let i = 0; i < seeded.length; i++) {
      const parts = []; for await (const bytes of resourceBytes(locator, decoded.entries[i])) {parts.push(bytes);}
      assert.deepEqual(Buffer.concat(parts), seeded[i].bytes);
    }
    const audit = (await readdir(request.outputRoot, {recursive: true})).find(name => name.endsWith("entries.jsonl"));
    const rows = (await readFile(join(request.outputRoot, audit), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    for (const row of rows.filter(row => row.archive === "seeded.pack" && row.kind === "resource")) {
      assert.equal(row.sourceIntegrityVerified, false); assert.deepEqual(row.corrections, ["FILTER_SEED_ONLY"]);
    }
    assert.deepEqual(await readFile(request.locators["seeded.pack"].path), source);
  });
}
for (const defect of ["mixed", "single-corrupt", "unsupported"]) {
  test(`rejects ${defect} metadata rather than bypassing a corrupt checksum`, async t => {
    const {request} = await input(t, defect);
    await assert.rejects(normalizeContent(request), /CHECKSUM_MISMATCH/u);
    await assert.rejects(readFile(join(request.outputRoot, "seeded.pack")), /ENOENT/u);
  });
}
test("cannot authenticate a seed-only archive with fewer than three independent source checksums", async t => {
  const {request} = await input(t, "insufficient");
  await assert.rejects(normalizeContent(request), /FILTER_UNAVAILABLE/u);
  await assert.rejects(readFile(join(request.outputRoot, "seeded.pack")), /ENOENT/u);
});
