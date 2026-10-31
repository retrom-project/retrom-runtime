import {test} from "node:test";
import assert from "node:assert/strict";
import {deriveHxMaterial, parseHxTable, encodeHxNamespace, decryptHxPayload} from "./kirikiri/hxv4-crypto.mjs";
import {createHxManager, applyHxState} from "./kirikiri/hxv4-filter.mjs";
import {hxPathHash, hxFileHash, selectHxMedia} from "./kirikiri/hxv4-names.mjs";
import {mkdtemp, writeFile, readFile, rm, access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {hxFixture} from "../tests/kirikiri-hxv4-fixture.mjs";
import {normalizeContent} from "./runtime-normalize-content.mjs";
import {readXp3, indexes} from "./kirikiri/xp3.mjs";
import {resourceBytes} from "./kirikiri/bytes.mjs";
import {openContent} from "./runtime-host-content.mjs";

const params = Buffer.from("00010203040506070001020304050102000134127856", "hex");
test("derives the independently published synthetic Hxv4 bootstrap vector", () => {
  const material = deriveHxMaterial(params, "Synthetic Bootstrap (C) Test.", "Warning! synthetic author rights.", "{SyntheticUnique}", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(material.key.toString("hex"), "354bb298eaeb75f75ab6df8d841048d55521bee04f3dd693b05cbc927066aa6a");
  assert.equal(material.nonce1.toString("hex"), "58aec2a530568ea05441a827570ec3e4b1acd53f954306f1");
  assert.equal(material.nonce0.toString("hex"), "cc5306ef36018797a6227da78d6a9b1dff9648ee4d40f089");
});
test("rejects unauthenticated Hxv4 payloads before treating them as an index", () => {
  assert.throws(() => decryptHxPayload(Buffer.alloc(128), Buffer.alloc(32), Buffer.alloc(24)), /AUTHENTICATION_FAILED/u);
});
test("requires the media salt to resolve startup in the root directory", () => {
  const media = "arbitrary-salt", profile = {strings: [media]};
  const records = [
    {pathHash: hxPathHash("", media), fileHash: hxFileHash("other.tjs", media)},
    {pathHash: hxPathHash("nested/", media), fileHash: hxFileHash("startup.tjs", media)},
  ];
  assert.throws(() => selectHxMedia(profile, records), /HASHER_UNSUPPORTED/u);
  records.push({pathHash: hxPathHash("", media), fileHash: hxFileHash("startup.tjs", media)});
  assert.equal(selectHxMedia(profile, records), media);
});
const i32 = value => {const b = Buffer.alloc(4); b.writeInt32BE(value); return b;};
const arr = items => Buffer.concat([Buffer.from([0x81]), i32(items.length), ...items]);
const octet = bytes => Buffer.concat([Buffer.from([3]), i32(bytes.length), bytes]);
const integer = value => {const b = Buffer.alloc(9); b[0] = 4; b.writeBigInt64BE(BigInt.asIntN(64, value), 1); return b;};
function table({packed = 0x0000000100000017n, key = 0xfedcba9876543210n} = {}) {
  return arr([octet(Buffer.alloc(8, 7)), arr([octet(Buffer.alloc(32, 9)), arr([integer(packed), integer(key)])])]);
}
test("keeps synthetic ID, per-entry local flags and unsigned 64-bit key distinct", () => {
  const [row] = parseHxTable(table());
  assert.equal(row.entryId, 23); assert.equal(row.archiveSlot, 0); assert.equal(row.localFlags, 1); assert.equal(row.entryKey, 0xfedcba9876543210n);
  const output = encodeHxNamespace("arbitrary", [{...row, fileIndex: 8}]);
  assert.equal(output.length, 8 + 18 + 52); assert.equal(output.readUInt32LE(18 + 8 + 40), 23);
  assert.equal(output.readUInt16LE(18 + 8 + 46), 1); assert.equal(output.readUInt32LE(18 + 8 + 48), 8);
});
test("rejects truncated, trailing, duplicate or differently shaped native tables", () => {
  const bytes = table();
  for (const b of [bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from([0])]), arr([integer(1n)]), arr([])]) {assert.throws(() => parseHxTable(b));}
  const row = arr([integer(0n), integer(1n)]);
  assert.throws(() => parseHxTable(arr([octet(Buffer.alloc(8)), arr([octet(Buffer.alloc(32)), row, octet(Buffer.alloc(32)), row])])), /NAME_MAP_INVALID/u);
  assert.throws(() => encodeHxNamespace("media", [{...parseHxTable(table({packed: 1n << 48n}))[0], fileIndex: 1}]));
});
test("stream filter preserves arbitrary absolute split reads, prefix and sparse corrections", () => {
  const material = {params, table: Uint32Array.from({length: 1024}, (_, i) => Math.imul(i, 0x9e3779b9) >>> 0), nonce0: Buffer.alloc(24)};
  const manager = createHxManager(material), state = manager.state(0x1122334455667788n, 1);
  const source = Buffer.from(Array.from({length: 90000}, (_, i) => i * 17 & 255)), whole = applyHxState(Buffer.from(source), 0, state), split = Buffer.from(source);
  for (const [start, end] of [[0, 7], [7, 16], [16, 31], [31, 24791], [24791, 65536], [65536, source.length]]) {applyHxState(split.subarray(start, end), start, state);}
  assert.deepEqual(split, whole); assert.notDeepEqual(whole, source); assert.deepEqual(applyHxState(whole, 0, state), source);
});
test("all VM lanes retain independently compiled synthetic generator/interpreter vectors", () => {
  const p = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 0, 1, 2, 1, 0x34, 0x12, 0x78, 0x56]);
  const manager = createHxManager({params: p, table: Uint32Array.from({length: 1024}, (_, i) => Math.imul(i, 0x9e3779b9) >>> 0), nonce0: Buffer.alloc(24)});
  for (const [input, expected] of [[0, 0x4fa8601f4fa8601en], [1, 0x96a9bd46ce685895n], [0x12345678, 0x4238b856adf8379dn],
    [0x55667788, 0xc3a8214a60838574n], [0x11223344, 0x3ce50f4f3ca08682n], [0xffffffff, 0x010000013caf6a4an]]) {assert.equal(manager.drip(input), expected);}
});
async function fixtureInput(t, mutate) {
  const root = await mkdtemp(join(tmpdir(), "hxv4-normalize-")); t.after(() => rm(root, {force: true, recursive: true}));
  const fixture = hxFixture(), files = [], locators = {};
  mutate?.(fixture);
  for (const [key, bytes] of [["engine.application", fixture.exe], ["assets.pack", fixture.archive]]) {
    const path = join(root, `source-${files.length}`), adjacent = Buffer.from("unrelated adjacent object bytes");
    await writeFile(path, Buffer.concat([adjacent, bytes, adjacent]));
    files.push({logicalKey: key, name: key, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    locators[key] = {path, offset: adjacent.length, sizeBytes: bytes.length};
  }
  return {fixture, input: {platformId: "kirikiri", files, locators, outputRoot: join(root, "output")}};
}
test("normalizes a complete authenticated hash namespace without requiring guessed plaintext names", async t => {
  const {fixture, input} = await fixtureInput(t), before = await Promise.all(input.files.map(f => readFile(input.locators[f.logicalKey].path)));
  const result = await normalizeContent(input);
  assert.equal(result.normalization?.verifiedEntries, 3);
  assert.deepEqual(result.normalization.formatCounts, {"hxv4-decoded": 1});
  const output = result.files.find(f => f.logicalKey === "assets.pack"), locator = {path: output.path, offset: 0, sizeBytes: output.sizeBytes};
  const decoded = await readXp3(locator, {includePlainEntries: true}), handle = await openContent(locator);
  let rows; try {rows = await indexes(handle);} finally {await handle.close();}
  const namespace = rows.find(row => row.tag === "RHx4").bytes;
  assert.equal(namespace.readUInt32LE(), fixture.media.length); assert.equal(namespace.toString("utf16le", 4, 4 + fixture.media.length * 2), fixture.media);
  const start = 8 + fixture.media.length * 2;
  for (let i = 0; i < 3; i++) {
    const source = fixture.resources.find(r => r.id === namespace.readUInt32LE(start + i * 52 + 40)), index = namespace.readUInt32LE(start + i * 52 + 48);
    const chunks = []; for await (const bytes of resourceBytes(locator, decoded.entries[index])) {chunks.push(bytes);}
    assert.deepEqual(Buffer.concat(chunks), source.bytes); assert.equal(decoded.entries[index].flags, 0);
  }
  const repeated = await normalizeContent({...input, outputRoot: input.outputRoot + "-second"}); t.after(() => rm(input.outputRoot + "-second", {force: true, recursive: true}));
  const facts = value => value.files.map(({logicalKey, sizeBytes, sha256}) => ({logicalKey, sizeBytes, sha256}));
  assert.deepEqual(facts(repeated), facts(result));
  assert.deepEqual(await Promise.all(input.files.map(f => readFile(input.locators[f.logicalKey].path))), before);
});
test("does not publish any staging result when an authenticated body's complete checksum fails", async t => {
  const {input} = await fixtureInput(t, f => {f.archive[19 + 70001 * 2 + 40] ^= 1;});
  await assert.rejects(normalizeContent(input), /CHECKSUM_MISMATCH/u);
  await assert.rejects(access(input.outputRoot));
});
