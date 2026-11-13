import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {normalizeContent} from "./runtime-normalize-content.mjs";
import {readXp3} from "./kirikiri/xp3.mjs";
import {adler32, chunk, magic, uint64, resourceBytes} from "./kirikiri/bytes.mjs";
import {prefixPE} from "../tests/kirikiri-prefix-fixture.mjs";

// Ordinary XP3 with source checksums and an independent scalar transform.
function archive(resources, corruptLast = false) {
  const bodies = [], rows = []; let offset = 19;
  for (const [index, entry] of resources.entries()) {
    const checksum = adler32(entry.bytes), body = Buffer.from(entry.bytes), key = checksum >>> 9 & 255;
    for (let i = 12; i < body.length; i++) body[i] ^= key;
    if (corruptLast && index === resources.length - 1) body[body.length - 1] ^= 1;
    const name = Buffer.from(entry.name, "utf16le"), info = Buffer.alloc(22), segment = Buffer.alloc(28), adler = Buffer.alloc(4);
    info.writeUInt32LE(0x80000000); info.writeBigUInt64LE(BigInt(body.length), 4); info.writeBigUInt64LE(BigInt(body.length), 12);
    info.writeUInt16LE(name.length / 2, 20); segment.writeBigUInt64LE(BigInt(offset), 4);
    segment.writeBigUInt64LE(BigInt(body.length), 12); segment.writeBigUInt64LE(BigInt(body.length), 20); adler.writeUInt32LE(checksum);
    rows.push(chunk("File", Buffer.concat([chunk("info", Buffer.concat([info, name])), chunk("segm", segment), chunk("adlr", adler)])));
    bodies.push(body); offset += body.length;
  }
  const rowsBytes = Buffer.concat(rows);
  return Buffer.concat([magic, uint64(offset), ...bodies, Buffer.from([0]), uint64(rowsBytes.length), rowsBytes]);
}
async function request(t, resources, corruptLast = false) {
  const root = await mkdtemp(join(tmpdir(), "prefix-normalize-")); t.after(() => rm(root, {recursive: true, force: true}));
  const sources = [["arbitrary.pack", archive(resources, corruptLast)], ["plugin/any-name.tpm", prefixPE()]];
  const files = [], locators = {};
  for (const [name, bytes] of sources) {
    const path = join(root, `source-${files.length}`); await writeFile(path, bytes);
    files.push({logicalKey: name, name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    locators[name] = {path, offset: 0, sizeBytes: bytes.length};
  }
  return {platformId: "kirikiri", files, locators, outputRoot: join(root, "output")};
}
const resources = count => Array.from({length: count}, (_, i) => ({name: `nested/resource-${i}.bin`,
  bytes: Buffer.from(Array.from({length: 70001 + i}, (_, n) => (n * 17 + i * 31) & 255))}));

test("prefix normalization authenticates and verifies resources independently of module names", async t => {
  const originals = resources(3), input = await request(t, originals), result = await normalizeContent(input);
  assert.equal(result.normalization?.verifiedEntries, 3);
  const output = result.files.find(file => file.logicalKey === "arbitrary.pack");
  const decoded = await readXp3({path: output.path, offset: 0, sizeBytes: output.sizeBytes}, {includePlainEntries: true});
  for (const [i, entry] of decoded.entries.entries()) {
    const chunks = []; for await (const bytes of resourceBytes(decoded.locator, entry)) chunks.push(bytes);
    assert.deepEqual(Buffer.concat(chunks), originals[i].bytes);
  }
  assert.deepEqual(await readFile(input.locators["arbitrary.pack"].path), archive(originals));
});
test("prefix normalization rejects corruption after the probe window and removes incomplete output", async t => {
  const input = await request(t, resources(35), true);
  await assert.rejects(normalizeContent(input), /CHECKSUM_MISMATCH/u);
  await assert.rejects(readFile(join(input.outputRoot, "arbitrary.pack")), /ENOENT/u);
});
