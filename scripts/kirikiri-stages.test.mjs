import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, writeFile, readFile, rm, readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {createCxFilter} from "./kirikiri/cxdec.mjs";
import {readXp3} from "./kirikiri/xp3.mjs";
import {adler32, resourceBytes, chunk, uint64, magic} from "./kirikiri/bytes.mjs";
import {normalizeContent} from "./runtime-normalize-content.mjs";
import {probeStage} from "./kirikiri/stages.mjs";
import {profile, delegatedFixture} from "../tests/kirikiri-classic-fixture.ts";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function bulk(bytes, seed) {
  const p = profile(), filter = createCxFilter(p), boundary = (seed & p.mask) + p.offset;
  const folded = (seed ^ seed >>> 16) >>> 0;
  const keys = [seed, folded].map(h => (filter.evaluateLane(h & 127, h >>> 7) & 255) || 1);
  for (let i = 0; i < bytes.length; i++) {bytes[i] ^= keys[Number(i >= boundary)];}
  return bytes;
}
function archive(resources) {
  const data = [], rows = []; let offset = 19;
  for (const entry of resources) {
    const name = Buffer.from(entry.name, "utf16le"), body = Buffer.from(entry.bytes), seed = entry.adler ?? adler32(body);
    entry.crypt?.(body, seed);
    const info = Buffer.alloc(22), segment = Buffer.alloc(28), checksum = Buffer.alloc(4);
    info.writeUInt32LE(entry.raw ? 0 : 0x80000000); info.writeBigUInt64LE(BigInt(entry.declared ?? body.length), 4);
    info.writeBigUInt64LE(BigInt(entry.declared ?? body.length), 12); info.writeUInt16LE(name.length / 2, 20);
    segment.writeBigUInt64LE(BigInt(offset), 4); segment.writeBigUInt64LE(BigInt(body.length), 12); segment.writeBigUInt64LE(BigInt(body.length), 20);
    checksum.writeUInt32LE(seed);
    rows.push(chunk("File", Buffer.concat([chunk("info", Buffer.concat([info, name])), chunk("segm", segment), chunk("adlr", checksum)])));
    data.push(body); offset += body.length;
  }
  const index = Buffer.concat(rows);
  return Buffer.concat([magic, uint64(offset), ...data, Buffer.from([0]), uint64(index.length), index]);
}
async function request(t, resources, module = delegatedFixture()) {
  const root = await mkdtemp(join(tmpdir(), "native-stages-")); t.after(() => rm(root, {force: true, recursive: true}));
  const modules = [["content.pack", archive(resources)], ["plugins/resource-reader.tpm", module]], files = [], locators = {};
  for (const [key, bytes] of modules) {
    const path = join(root, `source-${files.length}`); await writeFile(path, bytes);
    files.push({logicalKey: key, name: key, sizeBytes: bytes.length, sha256: digest(bytes)});
    locators[key] = {path, offset: 0, sizeBytes: bytes.length};
  }
  return {platformId: "kirikiri", files, locators, outputRoot: join(root, "output")};
}
function resources() {
  const filter = createCxFilter(profile());
  return ["nested/intro.txt", "pictures/asset.bin", "arbitrary/audio.dat"].map((name, i) => ({name,
    bytes: Buffer.from(Array.from({length: 70001 + i * 13}, (_, n) => (n * 17 + i * 31) & 255)),
    crypt: i === 0 ? bulk : (bytes, seed) => filter.apply(bytes, seed)}));
}
test("keeps the legacy bulk stage distinct from sparse patches and preserves absolute chunk offsets", () => {
  const filter = createCxFilter(profile()), source = Buffer.from(Array.from({length: 70000}, (_, i) => (i * 13 + 7) & 255));
  const output = filter.applyBulk(Buffer.from(source), 1);
  assert.equal(digest(output), "f79a46a90a35984600dc8be2857c6fdb1bccae264e3573ad5c46282d23d88355");
  assert.notDeepEqual(output, filter.apply(Buffer.from(source), 1));
  const split = Buffer.from(source);
  for (const [start, end] of [[0, 13], [13, 856], [856, 65537], [65537, source.length]]) {filter.applyBulk(split.subarray(start, end), 1, start);}
  assert.deepEqual(split, output);
});
test("normalizes mixed native stages by whole-resource checksum without entry-name rules", async t => {
  const entries = resources(), input = await request(t, entries), source = await readFile(input.locators["content.pack"].path);
  const result = await normalizeContent(input);
  assert.equal(result.normalization?.verifiedEntries, 3); assert.equal(result.normalization?.metadataCorrections, 0);
  const output = result.files.find(file => file.logicalKey === "content.pack"), index = await readXp3({path: output.path, offset: 0, sizeBytes: output.sizeBytes}, {includePlainEntries: true});
  for (let i = 0; i < entries.length; i++) {
    const parts = []; for await (const bytes of resourceBytes(index.locator, index.entries[i])) {parts.push(bytes);}
    assert.deepEqual(Buffer.concat(parts), entries[i].bytes);
  }
  assert.deepEqual(await readFile(input.locators["content.pack"].path), source);
});
test("does not enable another native stage without its connected ABI evidence", async t => {
  const module = delegatedFixture(); module[0x1602] = 20;
  const input = await request(t, resources(), module);
  await assert.rejects(normalizeContent(input), /FILTER_UNAVAILABLE/u);
  await assert.rejects(readFile(join(input.outputRoot, "content.pack")), /ENOENT/u);
});
test("rejects different stage outputs even when their complete Adler32 values collide", () => {
  const source = Buffer.from([1, 2, 3]);
  const stages = [{id: "first", apply() {}}, {id: "second", apply(bytes) {bytes.set([2, 0, 4]);}}];
  assert.equal(adler32(source), adler32(Buffer.from([2, 0, 4])));
  assert.throws(() => probeStage({stages}, source, 7, adler32(source)), /FILTER_AMBIGUOUS/u);
  assert.deepEqual(source, Buffer.from([1, 2, 3]));
});
test("rejects a later corrupt resource and removes incomplete staged output", async t => {
  const entries = Array.from({length: 9}, (_, i) => ({...resources()[i % 3], name: `resource-${i}.bin`,
    bytes: Buffer.alloc(70001 + i, i + 17), ...(i === 8 ? {adler: 12345} : {})}));
  const input = await request(t, entries);
  await assert.rejects(normalizeContent(input), /CHECKSUM_MISMATCH/u);
  await assert.rejects(readFile(join(input.outputRoot, "content.pack")), /ENOENT/u);
});
test("recognizes bounded ordinary protector metadata by structure and full body and audits lost source integrity", async t => {
  const warning = {name: "$$$ This is a protected archive. $$$ synthetic notice.txt", raw: true, declared: 1200,
    bytes: Buffer.from("Warning: Extracting this archive is a synthetic format notice."), adler: 12345};
  const input = await request(t, [...resources(), warning]), result = await normalizeContent(input);
  assert.equal(result.normalization?.verifiedEntries, 3); assert.equal(result.normalization?.metadataCorrections, 1);
  assert.equal(result.normalization.details[0].code, "FORMAT_WARNING_SHORT_STREAM");
  const audit = (await readdir(input.outputRoot)).find(name => name.startsWith(".audit-"));
  const records = (await readFile(join(input.outputRoot, audit, "entries.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(records.find(row => row.logicalName === warning.name).sourceIntegrityVerified, false);
  const output = result.files.find(file => file.logicalKey === "content.pack"), decoded = await readXp3({path: output.path, offset: 0, sizeBytes: output.sizeBytes}, {includePlainEntries: true});
  const contents = []; for await (const bytes of resourceBytes(decoded.locator, decoded.entries.at(-1))) {contents.push(bytes);}
  assert.deepEqual(Buffer.concat(contents), warning.bytes);
  for (const entry of [{...warning, name: "ordinary.txt"}, {...warning, name: `/${warning.name}`}, {...warning, name: `../${warning.name}`},
    {...warning, name: warning.name.replace("synthetic", "/../synthetic")}, {...warning, bytes: Buffer.from("ordinary truncated data")}, {...warning, declared: 1000000},
    {...warning, bytes: Buffer.concat([warning.bytes, Buffer.from([0x81])])}]) {
    const bytes = archive([entry]), path = join(input.outputRoot, "invalid-source"); await writeFile(path, bytes);
    await assert.rejects(readXp3({path, offset: 0, sizeBytes: bytes.length}, {includePlainEntries: true}), /ARCHIVE_INVALID/u);
  }
});
