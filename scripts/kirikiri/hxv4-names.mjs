import {createHash} from "node:crypto";
import {requireFormat} from "./bytes.mjs";

const mask = (1n << 64n) - 1n, cut = v => v & mask;
const rotate = (v, n) => cut(v << BigInt(n) | v >> BigInt(64 - n));
function round(s) {
  s[0] = cut(s[0] + s[1]); s[1] = rotate(s[1], 13) ^ s[0]; s[0] = rotate(s[0], 32);
  s[2] = cut(s[2] + s[3]); s[3] = rotate(s[3], 16) ^ s[2];
  s[0] = cut(s[0] + s[3]); s[3] = rotate(s[3], 21) ^ s[0];
  s[2] = cut(s[2] + s[1]); s[1] = rotate(s[1], 17) ^ s[2]; s[2] = rotate(s[2], 32);
}
/** No case/Unicode/extension rewriting occurs inside the native hash. */
export function hxPathHash(path, media) {
  const bytes = Buffer.from(path + media, "utf16le"), s = [0x736f6d6570736575n, 0x646f72616e646f6dn, 0x6c7967656e657261n, 0x7465646279746573n];
  let at = 0;
  for (; at + 8 <= bytes.length; at += 8) {const m = bytes.readBigUInt64LE(at); s[3] ^= m; round(s); round(s); s[0] ^= m;}
  let end = BigInt(bytes.length & 255) << 56n;
  for (let i = at; i < bytes.length; i++) {end |= BigInt(bytes[i]) << BigInt(8 * (i - at));}
  s[3] ^= end; round(s); round(s); s[0] ^= end; s[2] ^= 255n;
  for (let i = 0; i < 4; i++) {round(s);}
  const result = Buffer.alloc(8); result.writeBigUInt64LE(s[0] ^ s[1] ^ s[2] ^ s[3]); return result;
}
export function hxFileHash(name, media) {return createHash("blake2s256").update(name + media, "utf16le").digest();}
export function hxEntryId(name) {
  const units = Array.from({length: name.length}, (_, i) => name.charCodeAt(i));
  if (!units.length || units.length > 3 || units.some(u => u < 0x5000 || u > 0x8fff)) {return null;}
  let id = 0n;
  for (let i = 0; i < units.length; i++) {id |= BigInt(units[i] - 0x5000) << BigInt(14 * i);}
  if (id > 0xffffffffn || units.length > 1 && units.at(-1) === 0x5000) {return null;}
  return Number(id);
}
export function selectHxMedia(profile, records) {
  const identities = new Set(records.map(r => `${r.pathHash.toString("hex")}:${r.fileHash.toString("hex")}`));
  const candidates = profile.strings.filter(s => /^[a-z\d._-]{1,256}$/iu.test(s));
  const valid = [...new Set(candidates)].filter(media => identities.has(`${hxPathHash("", media).toString("hex")}:${hxFileHash("startup.tjs", media).toString("hex")}`));
  requireFormat(valid.length === 1, "HXV4_HASHER_UNSUPPORTED"); return valid[0];
}
