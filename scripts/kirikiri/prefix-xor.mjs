import {parsePe} from "./cxdec-pe.mjs";

const pattern = text => text.split(" ").map(byte => byte === "??" ? null : Number.parseInt(byte, 16));
const registration = pattern("8b 44 24 04 50 e8 ?? ?? ?? ?? a1 ?? ?? ?? ?? 83 c4 04 85 c0 75 12 68 ?? ?? ?? ?? e8 ?? ?? ?? ?? 83 c4 04 a3 ?? ?? ?? ?? 68 ?? ?? ?? ?? ff d0 33 c0 c2 04 00");
const guard = pattern("83 ec 08 56 8b 74 24 10 83 3e 18 74 22 a1 ?? ?? ?? ?? 85 c0 75 12 68 ?? ?? ?? ?? e8 ?? ?? ?? ?? 83 c4 04 a3 ?? ?? ?? ?? 68 ?? ?? ?? ?? ff d0");
const consumer = pattern("8b 56 14 33 c0 c1 ea ?? 39 46 10 76 27 57 8d 49 00 8b c8 33 ff 03 4e 04 13 7e 08 89 7c 24 0c 75 05 83 f9 ?? 76 07 8b 4e 0c 03 c8 30 11 40 3b 46 10 72 de 5f 5e 83 c4 08 c2 04 00");
const matches = (bytes, at, values, end) => at >= 0 && at + values.length <= end &&
  values.every((value, i) => value === null || bytes[at + i] === value);
function literal(bytes, pe, address, value) {
  const expected = Buffer.from(value + "\0"), offset = pe.fromVa(address, expected.length);
  return offset !== null && bytes.subarray(offset, offset + expected.length).equals(expected);
}

/** Recover an offset-aware callback connected to the native extraction API.
 * Both the shift and preserved prefix come from its instructions. Checksummed
 * resources independently authenticate a profile before any conversion.
 */
export function discoverPrefixProfiles(input) {
  if (!(input instanceof Uint8Array) || input.length > 64 * 1024 * 1024) {return [];}
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), pe = parsePe(bytes);
  if (!pe) {return [];}
  const profiles = new Map();
  for (const section of pe.sections.filter(value => value.executable)) {
    for (let at = section.raw; at + registration.length <= section.end; at++) {
      if (!matches(bytes, at, registration, section.end) || bytes.readUInt32LE(at + 11) !== bytes.readUInt32LE(at + 36) ||
          !literal(bytes, pe, bytes.readUInt32LE(at + 23), "void ::TVPSetXP3ArchiveExtractionFilter(tTVPXP3ArchiveExtractionFilter)")) {continue;}
      const callback = pe.fromVa(bytes.readUInt32LE(at + 41), guard.length + consumer.length, true);
      if (callback === null || !matches(bytes, callback, guard, bytes.length) ||
          !matches(bytes, callback + guard.length, consumer, bytes.length) ||
          bytes.readUInt32LE(callback + 14) !== bytes.readUInt32LE(callback + 36) ||
          pe.callTarget(at + 27) === null || pe.callTarget(at + 27) !== pe.callTarget(callback + 27) ||
          !literal(bytes, pe, bytes.readUInt32LE(callback + 23), "void ::TVPThrowExceptionMessage(const tjs_char *)")) {continue;}
      const profile = {shift: bytes[callback + guard.length + 7], boundary: bytes[callback + guard.length + 35]};
      if (profile.shift < 1 || profile.shift > 31 || profile.boundary > 127) {continue;}
      profiles.set(JSON.stringify(profile), profile);
      if (profiles.size > 32) {throw new Error("CX_AMBIGUOUS: too many prefix profiles");}
    }
  }
  return [...profiles.values()];
}

export function createPrefixFilter({shift, boundary}) {
  if (!Number.isInteger(shift) || shift < 1 || shift > 31 || !Number.isInteger(boundary) || boundary < 0 || boundary > 127) {
    throw new Error("CX_PROFILE: invalid prefix profile");
  }
  return {unchangedSeed: seed => (seed >>> shift & 255) === 0, apply(bytes, seed, offset = 0) {
    if (!(bytes instanceof Uint8Array) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + bytes.length)) {
      throw new Error("CX_PROFILE: invalid resource range");
    }
    const key = seed >>> shift & 255;
    for (let i = Math.max(0, boundary + 1 - offset); i < bytes.length; i++) {bytes[i] ^= key;}
    return bytes;
  }};
}
