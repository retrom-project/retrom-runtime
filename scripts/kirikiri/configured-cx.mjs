import {createHash} from "node:crypto";
import {parsePe} from "./cxdec-pe.mjs";
import {validHxParams} from "./hxv4-crypto.mjs";
import {createDripValue} from "./hxv4-filter.mjs";

const marker = Buffer.from("--data--PARAMS\0", "ascii");
const setter = "void ::TVPSetXP3ArchiveExtractionFilter(tTVPXP3ArchiveExtractionFilter)";
const multiplier = Buffer.from([0x6d, 0x4e, 0xc6, 0x41]);
const increment = Buffer.from([0x39, 0x30, 0, 0]);

function records(bytes, section, start) {
  const found = new Map(); let at = start + 8;
  for (let count = 0; count < 32 && at < section.end; count++) {
    const end = bytes.indexOf(0, at);
    if (end < at || end >= section.end || end - at > 64) {return null;}
    if (end === at) {return found;}
    if (end + 3 > section.end) {return null;}
    const name = bytes.toString("ascii", at, end), size = bytes.readUInt16LE(end + 1), begin = end + 3;
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || found.has(name) || begin + size > section.end) {return null;}
    found.set(name, bytes.subarray(begin, begin + size)); at = begin + size;
  }
  return null;
}

function pushedString(bytes, pe, at, value) {
  if (bytes[at] !== 0x68) {return false;}
  const target = pe.fromVa(bytes.readUInt32LE(at + 1), value.length + 1, false);
  return target !== null && bytes.toString("ascii", target, target + value.length + 1) === `${value}\0`;
}

function nearbyCall(pe, bytes, at, end) {
  for (let p = at + 5; p + 5 <= Math.min(at + 24, end); p++) {
    const target = pe.callTarget(p); if (target !== null) {return target;}
  }
  return null;
}

function isCallback(bytes, pe, va) {
  const start = pe.fromVa(va, 1, true); if (start === null) {return false;}
  const section = pe.sectionAt(start), end = Math.min(start + 160, section.end);
  for (let p = start; p + 3 <= end; p++) {
    if (bytes[p] !== 0x83 || (bytes[p + 1] & 0xf8) !== 0x38 || bytes[p + 2] !== 24) {continue;}
    const base = bytes[p + 1] & 7;
    for (let q = p + 3; q + 3 <= Math.min(end, p + 48); q++) {
      if (bytes[q] === 0xff && bytes[q + 1] === (0x70 | base) && bytes[q + 2] === 20) {return true;}
    }
  }
  return false;
}

function hasLoader(bytes, pe, configVA) {
  const address = Buffer.alloc(4); address.writeUInt32LE(configVA + 8);
  for (const section of pe.sections.filter(value => value.executable)) {
    for (let p = section.raw; p + 5 < section.end; p++) {
      if (!pushedString(bytes, pe, p, "PARAMS")) {continue;}
      const parser = nearbyCall(pe, bytes, p, section.end);
      if (parser === null || !bytes.subarray(parser, Math.min(parser + 128, pe.sectionAt(parser).end)).includes(address)) {continue;}
      for (let q = p + 5; q + 5 < Math.min(p + 256, section.end); q++) {
        if (!pushedString(bytes, pe, q, "TABLE") || nearbyCall(pe, bytes, q, section.end) !== parser) {continue;}
        for (let r = q + 5; r + 5 < Math.min(p + 512, section.end); r++) {
          if (!pushedString(bytes, pe, r, setter)) {continue;}
          for (let s = r + 5; s + 5 < Math.min(r + 80, section.end); s++) {
            if (bytes[s] === 0x68 && isCallback(bytes, pe, bytes.readUInt32LE(s + 1))) {return true;}
          }
        }
      }
    }
  }
  return false;
}

function hasLegacyRandom(bytes, pe) {
  return pe.sections.filter(value => value.executable).some(section => {
    const first = bytes.indexOf(multiplier, section.raw);
    return first >= section.raw && first + 4 < section.end &&
      bytes.subarray(first + 4, Math.min(first + 64, section.end)).includes(increment);
  });
}

/** Recover bounded configuration only from a PE connected to the filter callback. */
export function discoverConfiguredProfiles(input) {
  if (!(input instanceof Uint8Array) || input.length > 64 * 1024 * 1024) {return [];}
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), pe = parsePe(bytes);
  if (!pe || !hasLegacyRandom(bytes, pe)) {return [];}
  const found = new Map();
  for (const section of pe.sections.filter(value => !value.executable)) {
    for (let at = section.raw; at < section.end;) {
      const start = bytes.indexOf(marker, at); if (start < 0 || start + marker.length > section.end) {break;}
      at = start + marker.length;
      const data = records(bytes, section, start), params = data?.get("PARAMS"), controlBlock = data?.get("TABLE");
      if (!params || !controlBlock || !validHxParams(params) || params[17] !== 0 || controlBlock.length !== 4096 ||
          !hasLoader(bytes, pe, pe.toVa(start))) {continue;}
      const key = createHash("sha256").update(params).update(controlBlock).digest("hex");
      found.set(key, {params: Buffer.from(params), controlBlock: Buffer.from(controlBlock)});
      if (found.size > 32) {throw new Error("CX_AMBIGUOUS: too many configured profiles");}
    }
  }
  return [...found.values()];
}

function region(value) {
  const first = Number(value >> 48n), second = Number(value >> 32n & 65535n);
  return {key: Number(value & 255n) || 1,
    patches: [[first, Number(value >> 8n & 255n)], [second + Number(first === second), Number(value >> 16n & 255n)]]};
}

/** Interpret the recovered profile without running the supplied native module. */
export function createConfiguredFilter(profile) {
  const params = Buffer.from(profile.params), block = Buffer.from(profile.controlBlock);
  if (!validHxParams(params) || params[17] !== 0 || block.length !== 4096) {throw new Error("CX_PROFILE: invalid configured profile");}
  const table = Uint32Array.from({length: 1024}, (_, i) => block.readUInt32LE(i * 4));
  const drip = createDripValue(params, table, {legacy: true});
  return {apply(bytes, seed, offset = 0) {
    if (!(bytes instanceof Uint8Array) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + bytes.length)) {throw new Error("CX_PROFILE: invalid resource range");}
    const left = region(drip(seed)), right = region(drip((seed ^ seed >>> 16) >>> 0));
    const split = params.readUInt16LE(20) + (seed & params.readUInt16LE(18));
    for (let i = 0; i < bytes.length; i++) {bytes[i] ^= offset + i < split ? left.key : right.key;}
    for (const [side, before] of [[left, true], [right, false]]) {
      for (const [position, value] of side.patches) {
        if (position >= offset && position < offset + bytes.length && (position < split) === before) {bytes[position - offset] ^= value;}
      }
    }
    return bytes;
  }};
}
