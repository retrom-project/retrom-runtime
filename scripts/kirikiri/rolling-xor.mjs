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

/** Recover a connected rolling-table callback from a supplied PE without executing it. */
export function discoverRollingProfiles(input) {
  if (!(input instanceof Uint8Array) || input.length > 64 * 1024 * 1024) {return [];}
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), pe = parsePe(bytes);
  if (!pe) {return [];}
  const found = new Map();
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
  const initial = Buffer.from(profile.table);
  if (initial.length !== 31) {throw new Error("CX_PROFILE: invalid rolling table");}
  return {apply(bytes, seed, offset = 0) {
    if (!(bytes instanceof Uint8Array) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + bytes.length)) {throw new Error("CX_PROFILE: invalid resource range");}
    let value = seed & 0x7fffffff; value = (value | value << 31) >>> 0;
    const table = Buffer.from(initial);
    for (let i = 0; i < table.length; i++) {table[i] ^= value & 255; value = ((value & 0xfffffffe) << 23 | value >>> 8) >>> 0;}
    for (let i = 0; i < bytes.length; i++) {bytes[i] ^= table[(offset + i) % table.length];}
    return bytes;
  }};
}
