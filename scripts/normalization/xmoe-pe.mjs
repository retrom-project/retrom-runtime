import {requireXmoe, xmoeLimits, xmoeName, xmoeRange} from "./xmoe-common.mjs";

const matches = (bytes, at, pattern) => at >= 0 && at + pattern.length <= bytes.length && pattern.every((x, i) => x === null || bytes[at + i] === x);
function find(bytes, pattern, start = 0, end = bytes.length) {
  const result = [], anchor = Buffer.from(pattern.slice(0, pattern.indexOf(null) < 0 ? pattern.length : pattern.indexOf(null)));
  requireXmoe(anchor.length > 0); let at = start;
  while ((at = bytes.indexOf(anchor, at)) >= 0 && at + pattern.length <= end) {
    if (matches(bytes, at, pattern)) {result.push(at); requireXmoe(result.length <= 16, "RUNTIME_XMOE_UNSUPPORTED");} at++;
  }
  return result;
}
function one(values) {requireXmoe(values.length === 1, "RUNTIME_XMOE_UNSUPPORTED"); return values[0];}
function layout(bytes) {
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") {return null;}
  const offset = bytes.readUInt32LE(60);
  if (offset < 64 || offset > Math.min(bytes.length - 24, 1024 * 1024)) {return null;}
  const count = bytes.readUInt16LE(offset + 6), optional = bytes.readUInt16LE(offset + 20), start = offset + 24;
  if (bytes.readUInt32LE(offset) !== 0x4550 || bytes.readUInt16LE(offset + 4) !== 0x14c || !count || count > 96 || optional < 104 ||
      start + optional + count * 40 > bytes.length || bytes.readUInt16LE(start) !== 0x10b) {return null;}
  const base = bytes.readUInt32LE(start + 28), sections = [];
  for (let i = 0; i < count; i++) {
    const p = start + optional + i * 40, raw = bytes.readUInt32LE(p + 20), length = bytes.readUInt32LE(p + 16), rva = bytes.readUInt32LE(p + 12);
    if (raw > bytes.length || length > bytes.length - raw || base + rva + length > 0x100000000 ||
        length && raw < start + optional + count * 40 || sections.some(s => length && s.length && (raw < s.raw + s.length && s.raw < raw + length || rva < s.rva + s.length && s.rva < rva + length))) {return null;}
    sections.push({raw, length, rva, executable: Boolean(bytes.readUInt32LE(p + 36) & 0x20000000)});
  }
  const fromVA = (va, length = 1) => {const s = sections.find(s => va >= base + s.rva && va + length <= base + s.rva + s.length); return s ? s.raw + va - base - s.rva : -1;};
  const toVA = at => {const s = sections.find(s => at >= s.raw && at < s.raw + s.length); return s ? base + s.rva + at - s.raw : -1;};
  return {base, sections, fromVA, toVA, exportRva: bytes.readUInt32LE(start + 96)};
}
const payloadLoop = [0x8b, 0x56, 4, 0x8b, 0xc8, 0x81, 0xe1, null, null, null, null, 0x8a, 0x89, null, null, null, null,
  0x30, 0x0c, 2, 0x40, 0x3b, 6, 0x72, 0xe7, 0x53, 0x57, 0x8b, 0x7e, 4, 0x81, 0x3f, null, null, null, null];
function headerParameters(bytes, pe, sections) {
  const pattern = [0x8b, 0x85, null, null, null, null, 0x81, 0xb5, null, null, null, null, null, null, null, null, 0x35,
    null, null, null, null, 0x81, 0xb5, null, null, null, null, null, null, null, null, 0x81, 0xb5, null, null, null, null, null, null, null, null];
  const at = one(sections.flatMap(s => find(bytes, pattern, s.raw, s.raw + s.length)).filter(p => {
    const raw = bytes.readInt32LE(p + 2); return bytes.readInt32LE(p + 8) === raw - 4 && bytes.readInt32LE(p + 23) === raw - 8 && bytes.readInt32LE(p + 33) === raw - 16;
  }));
  const open = one(find(bytes, [0x6a, 0, 0x68, 0x80, 0, 0, 0, 0x6a, 3, 0x6a, 0, 0x6a, 1, 0x68, 0, 0, 0, 0x80, 0x68, null, null, null, null], Math.max(0, at - 256), at));
  const nameAt = pe.fromVA(bytes.readUInt32LE(open + 19), 2); requireXmoe(nameAt >= 0);
  let end = nameAt;
  while (end + 2 <= bytes.length && end - nameAt <= xmoeLimits.name * 2 && bytes.readUInt16LE(end)) {end += 2;}
  requireXmoe(end + 2 <= bytes.length && bytes.readUInt16LE(end) === 0);
  requireXmoe(pe.fromVA(bytes.readUInt32LE(open + 19), end - nameAt + 2) === nameAt);
  const archiveName = xmoeName(bytes.subarray(nameAt, end));
  return {archiveName, headerXors: {packed: bytes.readUInt32LE(at + 12), raw: bytes.readUInt32LE(at + 17), count: bytes.readUInt32LE(at + 27), version: bytes.readUInt32LE(at + 37)}, at, open};
}
function textParameters(bytes, sections) {
  const pattern = [0x8a, 0x81, null, null, null, null, 0xc0, 0xc8, null, 0x88, 0x81, null, null, null, null, 0x41, 0x3b, 0xca, 0x72, 0xec];
  const at = one(sections.flatMap(s => find(bytes, pattern, s.raw, s.raw + s.length)).filter(p => bytes.readUInt32LE(p + 2) === bytes.readUInt32LE(p + 11)));
  const markers = find(bytes, [0x83, 0x3c, 0x37, null], Math.max(0, at - 256), at); requireXmoe(markers.length === 2);
  const rotation = bytes[at + 8], startMarker = bytes.readInt8(markers[0] + 3) >>> 0, endMarker = bytes.readInt8(markers[1] + 3) >>> 0;
  requireXmoe(rotation >= 1 && rotation <= 7 && startMarker >= 0xffffff80 && endMarker >= 0xffffff80 && startMarker !== endMarker, "RUNTIME_XMOE_UNSUPPORTED");
  return {rotation, startMarker, endMarker, at};
}
function profile(bytes, pe) {
  const sections = pe.sections.filter(s => s.executable), loops = sections.flatMap(s => find(bytes, payloadLoop, s.raw, s.raw + s.length));
  if (!loops.length) {return null;}
  const loop = one(loops), mask = bytes.readUInt32LE(loop + 7), keyAt = pe.fromVA(bytes.readUInt32LE(loop + 13), mask + 1);
  requireXmoe(mask >= 15 && mask < 65536 && (mask & (mask + 1)) === 0 && keyAt >= 0, "RUNTIME_XMOE_UNSUPPORTED");
  requireXmoe(bytes[loop + 80] === 0xe8, "RUNTIME_XMOE_UNSUPPORTED");
  const lz4 = pe.fromVA(pe.toVA(loop + 80) + 5 + bytes.readInt32LE(loop + 81), 256);
  requireXmoe(lz4 >= 0 && find(bytes, [0x0f, 0xb6, 0x1e, 0x46, 0x89, 0x5d, null, 0xc1, 0xeb, 4, 0x83, 0xfb, 15], lz4, lz4 + 256).length === 1,
    "RUNTIME_XMOE_UNSUPPORTED");
  const hash = one(sections.flatMap(s => find(bytes, [0x55, 0x8b, 0xec, 0x83, 0xec, 8, 0x53, 0x56, 0x8b, 0xda, 0x8b, 0xf1, 0x57, 0x81, 0xf3, null, null, null, null, 0x33, 0xff, 0x89, 0x5d, 0xfc, 0x83, 0xfa, 8], s.raw, s.raw + s.length)));
  requireXmoe(find(bytes, [0x95, 0xe9, 0xd1, 0x5b], hash, Math.min(hash + 256, bytes.length)).length >= 2, "RUNTIME_XMOE_UNSUPPORTED");
  const header = headerParameters(bytes, pe, sections), text = textParameters(bytes, sections);
  return {archiveName: header.archiveName, headerXors: header.headerXors, rotation: text.rotation, startMarker: text.startMarker, endMarker: text.endMarker, hashSeed: bytes.readUInt32LE(hash + 15), payloadMagic: bytes.readUInt32LE(loop + 32), key: Buffer.from(xmoeRange(bytes, keyAt, mask + 1)),
    evidence: {kind: "xmoe-static-companion", payloadLoop: pe.toVA(loop), key: pe.toVA(keyAt), header: pe.toVA(header.at), archiveOpen: pe.toVA(header.open), text: pe.toVA(text.at), hash: pe.toVA(hash), lz4: pe.toVA(lz4)}};
}
function exportedSections(bytes, pe) {
  const at = pe.fromVA(pe.base + pe.exportRva, 40); if (!pe.exportRva || at < 0) {return [];}
  const count = bytes.readUInt32LE(at + 20); if (!count || count > 4096) {return [];}
  const table = pe.fromVA(pe.base + bytes.readUInt32LE(at + 28), count * 4); if (table < 0) {return [];}
  const result = new Set();
  for (let i = 0; i < count; i++) {const rva = bytes.readUInt32LE(table + i * 4), s = pe.sections.find(s => s.executable && rva >= s.rva && rva < s.rva + s.length); if (s) {result.add(s);}}
  return [...result].filter(s => s.length >= 256 && s.length <= 4 * 1024 * 1024 && s.length % 4 === 0);
}
// The packed section's modal words are bounded candidate subtraction values,
// not a claim that the packer VM executed that operation. A candidate becomes
// a profile only after every independent native routine/table/address relation
// above agrees. No PE instruction is executed and no file identity is consulted.
export function probeXmoeCompanion(input, signal) {
  signal?.throwIfAborted(); if (input.length > xmoeLimits.image) {return null;}
  const bytes = Buffer.from(input);
  const pe = layout(bytes); if (!pe) {return null;}
  const direct = profile(bytes, pe); if (direct) {return {...direct, evidence: {...direct.evidence, bodyTransform: null}};}
  const found = []; let failure;
  for (const section of exportedSections(bytes, pe)) {
    const histogram = new Map();
    for (let at = section.raw; at < section.raw + section.length; at += 4) {const word = bytes.readUInt32LE(at); histogram.set(word, (histogram.get(word) ?? 0) + 1);}
    const words = [...histogram].toSorted((a, b) => b[1] - a[1]).slice(0, 2), candidates = new Set(words.filter(([, count]) => count >= 16).flatMap(([word]) => [word, (word - 0xcccccccc) >>> 0, (word - 0x90909090) >>> 0]));
    for (const key of candidates) {
      signal?.throwIfAborted(); const decoded = Buffer.from(bytes);
      for (let at = section.raw; at < section.raw + section.length; at += 4) {decoded.writeUInt32LE((bytes.readUInt32LE(at) - key) >>> 0, at);}
      try {
        const value = profile(decoded, pe);
        if (value) {found.push({...value, evidence: {...value.evidence, bodyTransform: {kind: "inferred-u32-subtract", sectionRva: section.rva, key}}});}
      } catch (error) {failure = error;}
    }
  }
  if (!found.length && failure) {throw failure;}
  if (!found.length) {return null;}
  return one(found);
}
