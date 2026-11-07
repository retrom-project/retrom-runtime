import {parsePe} from "./cxdec-pe.mjs";

const pattern = value => value.split(" ").map(byte => byte === "??" ? null : Number.parseInt(byte, 16));
const body = pattern("8b 43 14 8b d0 8b c8 c1 ea ?? 80 e2 ff 88 55 ?? 88 55 ?? 8b d0 d1 e9 c1 ea ?? 80 e1 ff 88 4d ?? 80 e2 ff 88 55 ?? 8b d0 c1 ea ?? 80 e2 ff 88 55 ?? 8b ca c7 45 ?? ?? ?? ?? ?? 33 ff eb 2f 8b c7 33 d2 03 43 04 13 53 08 83 fa 00 75 03 83 f8 ?? 76 14 8b 43 04 03 c7 23 45 ?? 8a 54 05 ?? 8b 43 0c 30 14 38 eb 06 8b 53 0c 30 0c 3a 47 3b 7b 10 72 cc");
const guard = pattern("8d 5d ?? 83 3b 18 74 0a b8 ?? ?? ?? ?? e8 ?? ?? ?? ?? 8b 15 ?? ?? ?? ?? 89 55 ?? 8a 15 ?? ?? ?? ?? 88 55 ??");
const record = Buffer.from("c703180000008b550c8953048b551089530889730c894b108b4d08894b14", "hex");
const matches = (bytes, at, values, end) => at >= 0 && at + values.length <= end &&
  values.every((value, i) => value === null || bytes[at + i] === value);

function connectedRecord(bytes, pe, at, section) {
  const before = at - guard.length, constructor = pe.callTarget(before - 5);
  if (!matches(bytes, before, guard, section.end) || before - 17 < section.raw || constructor === null ||
      !matches(bytes, before - 17, [0x8d, 0x45, bytes[before + 2]], section.end)) {return false;}
  const end = Math.min(constructor + 160, pe.sectionAt(constructor).end), fields = bytes.indexOf(record, constructor);
  return fields >= constructor && fields + record.length <= end &&
    bytes.subarray(fields + record.length, end).includes(Buffer.from([0xc2, 12, 0]));
}

function profile(bytes, at, section) {
  if (!matches(bytes, at, body, section.end)) {return null;}
  const local = bytes[at + 15], maskLocal = bytes[at + 53], mask = bytes.readUInt32LE(at + 54);
  const shifts = [bytes[at + 9], bytes[at + 9], 1, bytes[at + 25], bytes[at + 42]];
  if (local > 251 || [18, 31, 37, 48].some((offset, i) => bytes[at + offset] !== local + i + 1) ||
      bytes[at + 89] !== maskLocal || bytes[at + 93] !== local || mask > 4 ||
      maskLocal >= local - 3 && maskLocal <= local + 4 || shifts.some(value => value < 1 || value > 31) ||
      bytes[at + 79] > 127 || bytes[at - 10] !== local || bytes[at - 1] !== local + 4) {return null;}
  return {shifts, mask, boundary: bytes[at + 79]};
}

/** Recognize a connected inline PE32 archive reader; never execute native code. */
export function discoverInlineProfiles(input) {
  if (!(input instanceof Uint8Array) || input.length > 64 * 1024 * 1024) {return [];}
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), pe = parsePe(bytes);
  if (!pe) {return [];}
  const found = new Map();
  for (const section of pe.sections.filter(value => value.executable)) {
    for (let at = section.raw + 53; at + body.length <= section.end; at++) {
      if (bytes[at] !== 0x8b || bytes[at + 1] !== 0x43 || bytes[at + 2] !== 0x14) {continue;}
      const value = profile(bytes, at, section);
      if (value && connectedRecord(bytes, pe, at, section)) {
        found.set(JSON.stringify(value), value);
        if (found.size > 32) {throw new Error("CX_AMBIGUOUS: too many inline profiles");}
      }
    }
  }
  return [...found.values()];
}

export function createInlineFilter(profile) {
  const {shifts, mask, boundary} = profile;
  if (!Array.isArray(shifts) || shifts.length !== 5 || shifts.some(value => !Number.isInteger(value) || value < 1 || value > 31) ||
      !Number.isInteger(mask) || mask < 0 || mask > 4 || !Number.isInteger(boundary) || boundary < 0 || boundary > 127) {
    throw new Error("CX_PROFILE: invalid inline profile");
  }
  // Every key is a right shift of the seed, so zero leaves every byte intact
  // at every absolute offset, including representations unknown to the importer.
  return {unchangedSeed: seed => seed === 0, apply(bytes, seed, offset = 0) {
    if (!(bytes instanceof Uint8Array) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + bytes.length)) {throw new Error("CX_PROFILE: invalid resource range");}
    const table = shifts.map(shift => seed >>> shift & 255);
    for (let i = 0; i < bytes.length; i++) {const position = offset + i; bytes[i] ^= table[position <= boundary ? 4 : position & mask];}
    return bytes;
  }};
}
