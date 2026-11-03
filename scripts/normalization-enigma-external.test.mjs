// @vitest-environment node
import assert from "node:assert/strict";
import {test} from "node:test";
import {enigmaExternalMasks, enigmaIdeaDecrypt} from "./normalization/enigma-external.mjs";

const u32 = n => {const b = Buffer.alloc(4); b.writeUInt32LE(n); return b;};
function dynamicConfiguration(masks) {
  const wide = s => Buffer.concat([u32(s.length), Buffer.from(s, "utf16le")]);
  return Buffer.concat([
    u32(1), Buffer.from([4]), u32(1), u32(2), Buffer.from("Load"),
    Buffer.alloc(6), Buffer.from([2]), Buffer.from("en"), Buffer.alloc(12),
    u32(2), u32(5), u32(6), u32(1), Buffer.alloc(16), u32(1), Buffer.alloc(16),
    u32(1), Buffer.from([1, 2]), wide("key"), Buffer.from([3]), wide("value"), Buffer.from([4]), wide("name"),
    u32(1), Buffer.alloc(256), u32(1), Buffer.from([2]), wide("from"), wide("to"),
    u32(1), Buffer.alloc(512), u32(1), Buffer.alloc(544),
    u32(1), u32(7), Buffer.alloc(16), u32(3), Buffer.from([1, 2, 3]),
    u32(masks.length), ...masks.map(wide),
  ]);
}

test("reads only explicitly configured external package masks after variable configuration records", () => {
  assert.deepEqual(enigmaExternalMasks(dynamicConfiguration(["%DEFAULT FOLDER%\\lang.bin", "%DEFAULT FOLDER%\\packs\\*.vfs"])),
    ["%DEFAULT FOLDER%\\lang.bin", "%DEFAULT FOLDER%\\packs\\*.vfs"]);
  assert.deepEqual(enigmaExternalMasks(dynamicConfiguration([])), []);
});

test("rejects truncated, oversized and trailing dynamic package configuration", () => {
  const valid = dynamicConfiguration(["%DEFAULT FOLDER%\\resources.bin"]);
  assert.throws(() => enigmaExternalMasks(valid.subarray(0, -1)), /RUNTIME_ENIGMA_INVALID/);
  assert.throws(() => enigmaExternalMasks(Buffer.concat([valid, Buffer.from([1])])), /RUNTIME_ENIGMA_UNSUPPORTED/);
  assert.throws(() => enigmaExternalMasks(u32(0xffffffff)), /RUNTIME_ENIGMA_LIMIT/);
  assert.throws(() => enigmaExternalMasks(valid, globalThis.AbortSignal.abort()));
});

test("IDEA decoding validates keys and cancellation before allocating output", () => {
  assert.throws(() => enigmaIdeaDecrypt(Buffer.from([1]), Buffer.alloc(15)), /RUNTIME_ENIGMA_INVALID/);
  assert.throws(() => enigmaIdeaDecrypt(Buffer.from([1]), Buffer.alloc(16), globalThis.AbortSignal.abort()));
});

test("matches independent libgcrypt IDEA-CBC output including a partial final block", () => {
  // libgcrypt 1.11.0: IDEA key 0001..0008, IV = E_K(0). The independent
  // standard block check is 0000000100020003 -> 11fbed2b01986de5.
  const cipher = Buffer.from("0c146fabf0de8fe5e244b87e2f48ebf446ca9457cd4611d556baef508cae", "hex");
  assert.deepEqual(enigmaIdeaDecrypt(cipher, Buffer.from("00010002000300040005000600070008", "hex")),
    Buffer.from("configuration partial tail 123"));
  assert.deepEqual(enigmaIdeaDecrypt(cipher.subarray(0, 24), Buffer.from("00010002000300040005000600070008", "hex")),
    Buffer.from("configuration partial ta"));
});
