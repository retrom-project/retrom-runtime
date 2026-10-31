import {requireXmoe, xmoeLimits, xmoeName, xmoeNameHash, xmoeRange} from "./xmoe-common.mjs";
import {unpackXmoeIndex, unpackXmoeLz4} from "./xmoe-compression.mjs";
import {normalizeXmoePsb} from "./xmoe-psb.mjs";
export {xmoeLimits} from "./xmoe-common.mjs";

export function inspectXmoeHeader(header, profile, sourceSize) {
  requireXmoe(header.length === 24 && Number.isSafeInteger(sourceSize) && sourceSize >= 24);
  const xor = profile.headerXors, version = (header.readUInt32LE(4) ^ xor.version) >>> 0,
    count = (header.readUInt32LE(12) ^ xor.count) >>> 0, offset = header.readUInt32LE(8),
    packed = (header.readUInt32LE(16) ^ xor.packed) >>> 0, raw = (header.readUInt32LE(20) ^ xor.raw) >>> 0;
  requireXmoe(version === 1 && count > 0 && count <= xmoeLimits.entries && offset >= 24 && offset <= sourceSize && packed <= sourceSize - offset);
  requireXmoe(packed > 0 && packed <= xmoeLimits.index && raw > 0 && raw <= xmoeLimits.index, "RUNTIME_XMOE_LIMIT");
  return {count, offset, packed, raw};
}
export function inspectXmoeArchive(header, indexPacked, profile, sourceSize, signal) {
  signal?.throwIfAborted(); const meta = inspectXmoeHeader(header, profile, sourceSize);
  requireXmoe(indexPacked.length === meta.packed); const index = unpackXmoeIndex(indexPacked, meta.raw, signal), entries = [], seen = new Set();
  let at = 0, total = 0;
  while (at < index.length) {
    signal?.throwIfAborted(); const row = xmoeRange(index, at, 24), nameLength = row.readUInt32LE(20);
    requireXmoe(nameLength > 0 && nameLength <= xmoeLimits.name); const encoded = xmoeRange(index, at + 24, nameLength * 2);
    requireXmoe(xmoeRange(index, at + 24 + encoded.length, 2).readUInt16LE() === 0);
    const name = xmoeName(encoded), hash = xmoeNameHash(encoded, profile.hashSeed);
    requireXmoe(hash === row.readBigUInt64LE(4) && !seen.has(name)); seen.add(name);
    const offset = row.readUInt32LE(12), packed = row.readUInt32LE(16); total += packed;
    requireXmoe(offset >= 24 && packed >= 8 && packed <= xmoeLimits.file && offset <= meta.offset && packed <= meta.offset - offset);
    requireXmoe(total <= xmoeLimits.tree, "RUNTIME_XMOE_LIMIT"); entries.push({name, offset, packed}); at += 26 + encoded.length;
  }
  requireXmoe(entries.length === meta.count);
  const sorted = entries.toSorted((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++) {requireXmoe(sorted[i - 1].offset + sorted[i - 1].packed <= sorted[i].offset);}
  return entries;
}
export function decodeXmoePayload(payload, profile, signal) {
  signal?.throwIfAborted(); requireXmoe(payload.length >= 9 && payload.length <= xmoeLimits.file);
  requireXmoe(profile.key.length > 0 && profile.key.length <= 65536 && (profile.key.length & (profile.key.length - 1)) === 0 &&
    profile.rotation >= 1 && profile.rotation <= 7);
  const decoded = Buffer.alloc(payload.length), mask = profile.key.length - 1;
  for (let i = 0; i < payload.length; i++) {if ((i & 65535) === 0) {signal?.throwIfAborted();} decoded[i] = payload[i] ^ profile.key[i & mask];}
  requireXmoe(decoded.readUInt32LE() === profile.payloadMagic); const raw = unpackXmoeLz4(decoded.subarray(8), decoded.readUInt32LE(4), signal);
  return normalizeXmoePsb(raw, profile, signal);
}
