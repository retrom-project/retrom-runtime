import {parsePe} from "./cxdec-pe.mjs";

const setter = "void ::TVPSetXP3ArchiveExtractionFilter(tTVPXP3ArchiveExtractionFilter)";
const header = Buffer.from([0x55, 0x8b, 0xec, 0x83, 0xec, 0x24]);
const abi = Buffer.from([0x8b, 0x7d, 0x08, 0x83, 0x3f, 0x18]);
const seed = Buffer.from([0x8b, 0x4f, 0x14, 0x81, 0xe1, 0xff, 0xff, 0xff, 0x7f]);
const rotation = Buffer.from([0x30, 0x4c, 0x15, 0xdc, 0x8b, 0xc1, 0x83, 0xe0, 0xfe, 0xc1, 0xe9, 8,
  0xc1, 0xe0, 0x17, 0x42, 0x0b, 0xc8, 0x83, 0xfa, 0x1f, 0x7c, 0xe9]);
const consumer = Buffer.from([0x8b, 0x77, 0x0c, 0x33, 0xc0, 0x8b, 0xcb, 0x03, 0x4f, 4, 0x6a, 0,
  0x13, 0x47, 8, 0x6a, 0x1f, 0x50, 0x51, 0xe8]);
const consumerTail = Buffer.from([0x8a, 0x44, 0x05, 0xdc, 0x30, 0x04, 0x1e, 0x43, 0x3b, 0x5f, 0x10, 0x72, 0xdb]);

function within(bytes, pattern, start, end) {
  const at = bytes.indexOf(pattern, start);
  return at >= start && at + pattern.length <= end ? at : -1;
}
function callbackTable(bytes, pe, address) {
  const start = pe.fromVa(address, 1, true); if (start === null) {return null;}
  const end = Math.min(start + 512, pe.sectionAt(start).end);
  if (!bytes.subarray(start, start + header.length).equals(header) || within(bytes, abi, start, Math.min(start + 32, end)) < 0) {return null;}
  const seedAt = within(bytes, seed, start, Math.min(start + 96, end)); if (seedAt < 0) {return null;}
  const rotateAt = within(bytes, rotation, seedAt + seed.length, end); if (rotateAt < 0) {return null;}
  const consumerAt = within(bytes, consumer, rotateAt + rotation.length, end);
  if (consumerAt < 0 || pe.callTarget(consumerAt + consumer.length - 1) === null ||
      !bytes.subarray(consumerAt + consumer.length + 4, consumerAt + consumer.length + 4 + consumerTail.length).equals(consumerTail)) {return null;}
  let at = seedAt + seed.length; const table = Buffer.alloc(31);
  for (let i = 0; i < 7; i++) {
    const marker = Buffer.from([0xc7, 0x45, 0xdc + i * 4]), found = within(bytes, marker, at, rotateAt);
    if (found < 0 || found + 7 > rotateAt) {return null;}
    bytes.copy(table, i * 4, found + 3, found + 7); at = found + 7;
    if (i === 0 && !bytes.subarray(at, at + 2).equals(Buffer.from([0x8b, 0xc1]))) {return null;}
    if (i === 1 && !bytes.subarray(at, at + 5).equals(Buffer.from([0xc1, 0xe0, 0x1f, 0x0b, 0xc8]))) {return null;}
  }
  const word = within(bytes, Buffer.from([0x66, 0xc7, 0x45, 0xf8]), at, rotateAt);
  const byte = word < 0 ? -1 : within(bytes, Buffer.from([0xc6, 0x45, 0xfa]), word + 6, rotateAt);
  if (word < 0 || word + 6 > rotateAt || byte < 0 || byte + 4 > rotateAt) {return null;}
  bytes.copy(table, 28, word + 4, word + 6); table[30] = bytes[byte + 3];
  return table;
}

function dataReferences(bytes, pe, address) {
  const value = Buffer.alloc(4), found = []; value.writeUInt32LE(address);
  for (const section of pe.sections.filter(value => !value.executable)) {
    for (let at = bytes.indexOf(value, section.raw); at >= section.raw && at + 4 <= section.end; at = bytes.indexOf(value, at + 1)) {
      if ((at - section.raw) % 4 === 0) {found.push(at);}
      if (found.length > 32) {throw new Error("CX_AMBIGUOUS: too many rolling references");}
    }
  }
  return found;
}
function matches(bytes, start, pattern, end) {
  return start >= 0 && start + pattern.length <= end && pattern.every((value, i) => value === null || bytes[start + i] === value);
}
function inlineProfile(bytes, pe, address) {
  const start = pe.fromVa(address, 3, true); if (start === null) {return null;}
  const end = Math.min(start + 4096, pe.sectionAt(start).end);
  if (!matches(bytes, start, [0x55, 0x8b, 0xec], end)) {return null;}
  // The archive-entry seed and absolute stream position feed both loops.
  const source = Buffer.from([0x8b, 0x46, 8, 0x8d, 0x0c, 0x80, 0x8b, 0x46, 4, 0x8b, 0x80]);
  const at = within(bytes, source, start + 3, Math.min(start + 1024, end));
  if (at < 0 || !matches(bytes, at + 15, [0x8b, 0x4c, 0xc8, 4, 0x8b, 0x46, 0x30, 0x81, 0xf1,
    null, null, null, null, 0x81, 0xe1, 0xff, 0xff, 0xff, 0x7f, 0x89, 0x45, null,
    0x8b, 0xc1, 0xc1, 0xe0, 0x1f, 0x0b, 0xc8, 0x33, 0xd2], end)) {return null;}
  let loop = at + 46;
  if (matches(bytes, loop, [0x0f, 0x1f, 0], end)) {loop += 3;}
  const position = bytes[at + 36];
  if (!matches(bytes, loop, [0x8b, 0xc1, 0x88, 0x4c, 0x15, null, 0x83, 0xe0, 0xfe, 0xc1, 0xe9, 8,
    0xc1, 0xe0, 0x17, 0x42, 0x0b, 0xc8, 0x83, 0xfa, null, 0x7e, null], end) ||
      loop + 23 + bytes.readInt8(loop + 22) !== loop) {return null;}
  const mask = bytes[loop + 20], length = mask + 1, table = bytes[loop + 5], consume = loop + 23;
  if (length < 2 || length > 128 || (length & mask) !== 0 || !matches(bytes, consume,
    [0x85, 0xdb, 0x7e, 0x1f, 0x8b, 0x75, position, 0x8b, 0xcb, 0x2b, 0xf7,
      0x8d, 4, 0x3e, 0x83, 0xe0, mask, 0x8d, 0x7f, 1, 0x8a, 0x44, 5, table,
      0x30, 0x47, 0xff, 0x83, 0xe9, 1, 0x75, null], end) ||
      consume + 32 + bytes.readInt8(consume + 31) !== consume + 11) {return null;}
  return {table: Buffer.alloc(length), xorConstant: bytes.readUInt32LE(at + 24)};
}
function inlineProfiles(bytes, pe) {
  const name = Buffer.from(".?AVtTVPXP3ArchiveStream@@\0", "ascii"), found = [];
  for (const section of pe.sections.filter(value => !value.executable)) {
    for (let at = bytes.indexOf(name, section.raw); at >= section.raw + 8 && at + name.length <= section.end; at = bytes.indexOf(name, at + 1)) {
      // MSVC RTTI links the exact stream type to its vtable, whose second entry
      // implements Read. A matching instruction island alone is insufficient.
      for (const typeRef of dataReferences(bytes, pe, pe.toVa(at - 8))) {
        const locator = typeRef - 12;
        if (locator < pe.sectionAt(typeRef).raw || !bytes.subarray(locator, locator + 12).equals(Buffer.alloc(12)) ||
            locator + 20 > pe.sectionAt(typeRef).end || pe.fromVa(bytes.readUInt32LE(locator + 16), 16, false) === null) {continue;}
        for (const vtableRef of dataReferences(bytes, pe, pe.toVa(locator))) {
          if (vtableRef + 28 > pe.sectionAt(vtableRef).end || Array.from({length: 6}, (_, i) =>
            pe.fromVa(bytes.readUInt32LE(vtableRef + 4 + 4 * i), 1, true)).some(value => value === null)) {continue;}
          const profile = inlineProfile(bytes, pe, bytes.readUInt32LE(vtableRef + 8));
          if (profile) {found.push(profile);}
          if (found.length > 32) {throw new Error("CX_AMBIGUOUS: too many rolling profiles");}
        }
      }
    }
  }
  return found;
}

/** Recover a connected rolling-table callback from a supplied PE without executing it. */
export function discoverRollingProfiles(input) {
  if (!(input instanceof Uint8Array) || input.length > 64 * 1024 * 1024) {return [];}
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), pe = parsePe(bytes);
  if (!pe) {return [];}
  const found = new Map(inlineProfiles(bytes, pe).map(profile => [`${profile.xorConstant}:${profile.table.toString("hex")}`, profile]));
  for (const section of pe.sections.filter(value => value.executable)) {
    for (let at = section.raw; at + 5 < section.end; at++) {
      if (bytes[at] !== 0x68) {continue;}
      const stringAt = pe.fromVa(bytes.readUInt32LE(at + 1), setter.length + 1, false);
      if (stringAt === null || bytes.toString("ascii", stringAt, stringAt + setter.length + 1) !== `${setter}\0`) {continue;}
      for (let p = at + 5; p + 7 <= Math.min(at + 96, section.end); p++) {
        if (bytes[p] !== 0x68 || bytes[p + 5] !== 0xff || bytes[p + 6] !== 0xd0) {continue;}
        const table = callbackTable(bytes, pe, bytes.readUInt32LE(p + 1));
        if (table) {found.set(table.toString("hex"), {table});}
      }
    }
  }
  return [...found.values()];
}

export function createRollingFilter(profile) {
  const initial = Buffer.from(profile.table), xorConstant = profile.xorConstant ?? 0;
  if (!Number.isInteger(xorConstant) || xorConstant < 0 || xorConstant > 0xffffffff ||
      (profile.xorConstant === undefined ? initial.length !== 31 :
        initial.length < 2 || initial.length > 128 || (initial.length & (initial.length - 1)) !== 0)) {throw new Error("CX_PROFILE: invalid rolling table");}
  return {apply(bytes, seed, offset = 0) {
    if (!(bytes instanceof Uint8Array) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + bytes.length)) {throw new Error("CX_PROFILE: invalid resource range");}
    let value = (seed ^ xorConstant) & 0x7fffffff; value = (value | value << 31) >>> 0;
    const table = Buffer.from(initial);
    for (let i = 0; i < table.length; i++) {table[i] ^= value & 255; value = ((value & 0xfffffffe) << 23 | value >>> 8) >>> 0;}
    for (let i = 0; i < bytes.length; i++) {bytes[i] ^= table[(offset + i) % table.length];}
    return bytes;
  }};
}
