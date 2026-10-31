import * as crypto from "node:crypto";
import {inflate, maximumIndex, requireFormat} from "./bytes.mjs";

// Native protocol cross-check: xp3-brute 0.3.7 (MIT), krkr_exe.rs/hxv4.rs,
// eb71626801afd3d86ade797489b984b5cda20582. All title inputs come from the PE.
const u32 = value => value >>> 0;
const rol = (value, count) => u32(value << count | value >>> (32 - count));
function quarter(x, a, b, c, d) {
  x[a] = u32(x[a] + x[b]); x[d] = rol(x[d] ^ x[a], 16);
  x[c] = u32(x[c] + x[d]); x[b] = rol(x[b] ^ x[c], 12);
  x[a] = u32(x[a] + x[b]); x[d] = rol(x[d] ^ x[a], 8);
  x[c] = u32(x[c] + x[d]); x[b] = rol(x[b] ^ x[c], 7);
}
function chacha(state, doubleRounds) {
  const x = [...state];
  for (let i = 0; i < doubleRounds; i++) {
    quarter(x, 0, 4, 8, 12); quarter(x, 1, 5, 9, 13); quarter(x, 2, 6, 10, 14); quarter(x, 3, 7, 11, 15);
    quarter(x, 0, 5, 10, 15); quarter(x, 1, 6, 11, 12); quarter(x, 2, 7, 8, 13); quarter(x, 3, 4, 9, 14);
  }
  return x;
}
const words = bytes => Array.from({length: bytes.length / 4}, (_, i) => bytes.readUInt32LE(i * 4));
const constant = words(Buffer.from("expand 32-byte k"));
const bytes32 = values => {const out = Buffer.alloc(values.length * 4); values.forEach((v, i) => out.writeUInt32LE(u32(v), i * 4)); return out;};
export const hxDigest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
export function decryptBres(input, path, salt) {
  requireFormat(salt.length === 8192 && input.length <= maximumIndex && path.length > 0 && path.length <= 4096);
  const material = crypto.createHash("sha3-384").update(path, "utf16le").update(salt).digest(), m = words(material);
  const output = Buffer.alloc(input.length);
  for (let at = 0; at < input.length; at += 64) {
    const initial = [...constant, ...m.slice(0, 8), u32(m[10] ^ at / 64), m[11], m[8], m[9]];
    const stream = bytes32(chacha(initial, 4).map((word, i) => u32(word + initial[i])));
    for (let i = 0; i < Math.min(64, input.length - at); i++) {output[at + i] = input[at + i] ^ stream[i];}
  }
  return output;
}
function keyBlock(input, seed) {
  const w = new Uint32Array(8); let state = Math.imul(0x01000193, seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < input.length; i++) {
    let v = input[i] ^ state; v = Math.imul(v ^ v >>> 17, 0xed5ad4bb);
    v = Math.imul(v ^ v >>> 11, 0xac4c1b51); v = Math.imul(v ^ v >>> 15, 0x31848bab);
    state = u32(v ^ v >>> 14); w[i % 8] ^= state;
  }
  return crypto.createHash("blake2s256").update(input).update(bytes32([...w])).digest();
}
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i]));
export function validHxParams(p) {
  return p.length === 22 && [[0, 8], [8, 14], [14, 17]].every(([from, to]) =>
    [...p.subarray(from, to)].sort((a, b) => a - b).every((v, i) => v === i));
}
export function deriveHxMaterial(params, prefix, warning, unique, archiveSeed) {
  requireFormat(validHxParams(params) && archiveSeed.length === 8 && prefix.length <= 32767 && warning.length <= 32767 && unique.length <= 32767);
  requireFormat(typeof crypto.argon2Sync === "function", "HXV4_KDF_UNAVAILABLE");
  const bootstrap = Buffer.from(prefix + warning, "utf16le"), salt = crypto.createHash("sha3-224").update(params).digest().subarray(0, 16);
  const material = crypto.argon2Sync("argon2i", {message: bootstrap, nonce: salt, memory: 8, parallelism: 1, passes: 3, tagLength: 64});
  const key = xor(keyBlock(bootstrap, 0), material), nonce1 = xor(keyBlock(params, 1), material).subarray(0, 24);
  const nonce0 = xor(keyBlock(Buffer.from(unique, "utf16le"), 2), keyBlock(archiveSeed, archiveSeed.readUInt32LE())).subarray(0, 24);
  const expanded = crypto.createHash("shake256", {outputLength: 8192}).update(material).digest(), table = new Uint32Array(1024);
  for (let i = 0; i < 1024; i++) {table[i] = u32(expanded.readUInt32LE(i * 4) ^ ((params[17] & 1) ? expanded.readUInt32LE(4096 + i * 4) : 0));}
  return {key, nonce0, nonce1, table, params};
}
export function decryptHxPayload(payload, key, nonce) {
  requireFormat(payload.length >= 16 && payload.length <= maximumIndex && key.length === 32 && nonce.length === 24);
  const sub = chacha([...constant, ...words(key), ...words(nonce.subarray(0, 16))], 10);
  const subkey = bytes32([sub[0], sub[1], sub[2], sub[3], sub[12], sub[13], sub[14], sub[15]]);
  const iv = Buffer.concat([Buffer.alloc(4), nonce.subarray(16)]);
  let plain;
  try {
    const decoder = crypto.createDecipheriv("chacha20-poly1305", subkey, iv, {authTagLength: 16}); decoder.setAuthTag(payload.subarray(0, 16));
    plain = Buffer.concat([decoder.update(payload.subarray(16)), decoder.final()]);
  } catch {throw new Error("RUNTIME_KIRIKIRI_HXV4_AUTHENTICATION_FAILED");}
  requireFormat(plain.length >= 4);
  return inflate(plain.subarray(4), plain.readUInt32LE());
}

/** Hxv4's table is a restricted big-endian TJS Variant tree, not JSON or filenames. */
export function parseHxTable(bytes) {
  let at = 0;
  const take = size => {requireFormat(size >= 0 && at + size <= bytes.length); const value = bytes.subarray(at, at + size); at += size; return value;};
  const array = () => {requireFormat(take(1)[0] === 0x81); const count = take(4).readInt32BE(); requireFormat(count >= 0 && count <= 500000); return count;};
  const octet = size => {requireFormat(take(1)[0] === 3 && take(4).readInt32BE() === size); return Buffer.from(take(size));};
  const integer = () => {requireFormat(take(1)[0] === 4); return take(8).readBigInt64BE();};
  const domains = array(), records = [], seen = new Set(); requireFormat(domains > 0 && domains % 2 === 0);
  for (let i = 0; i < domains; i += 2) {
    const pathHash = octet(8), count = array(); requireFormat(count > 0 && count % 2 === 0);
    for (let j = 0; j < count; j += 2) {
      const fileHash = octet(32); requireFormat(array() === 2);
      const packed = integer(), entryKey = BigInt.asUintN(64, integer()); requireFormat(packed >= 0n);
      const entryId = Number(packed & 0xffffffffn), archiveSlot = Number(packed >> 48n), localFlags = Number(packed >> 32n & 65535n);
      const identity = `${pathHash.toString("hex")}:${fileHash.toString("hex")}`; requireFormat(!seen.has(identity), "NAME_MAP_INVALID"); seen.add(identity);
      records.push({pathHash, fileHash, entryId, archiveSlot, localFlags, entryKey}); requireFormat(records.length <= 250000, "ARCHIVE_LIMIT");
    }
  }
  requireFormat(at === bytes.length && records.length > 0); return records;
}

export function encodeHxNamespace(mediaName, records) {
  requireFormat(typeof mediaName === "string" && mediaName.length > 0 && mediaName.length <= 256 && !/[/\\:]/u.test(mediaName) &&
    [...mediaName].every(c => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127));
  requireFormat(records.length > 0 && records.length <= 250000, "ARCHIVE_LIMIT");
  const media = Buffer.from(mediaName, "utf16le"), bytes = Buffer.alloc(8 + media.length + records.length * 52);
  bytes.writeUInt32LE(media.length / 2); media.copy(bytes, 4); bytes.writeUInt32LE(records.length, 4 + media.length);
  let at = 8 + media.length;
  for (const record of records) {
    requireFormat(record.pathHash.length === 8 && record.fileHash.length === 32 && record.archiveSlot === 0 && Number.isSafeInteger(record.fileIndex));
    record.pathHash.copy(bytes, at); record.fileHash.copy(bytes, at + 8); bytes.writeUInt32LE(record.entryId, at + 40);
    bytes.writeUInt16LE(record.archiveSlot, at + 44); bytes.writeUInt16LE(record.localFlags, at + 46); bytes.writeUInt32LE(record.fileIndex, at + 48); at += 52;
  }
  return bytes;
}
