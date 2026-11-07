import {parsePe} from "./cxdec-pe.mjs";
import {requireFormat} from "./bytes.mjs";

const pattern = value => value.split(" ").map(byte => byte === "??" ? null : Number.parseInt(byte, 16));
const dispatch = [
  pattern("6a 0b 8d 55 c8 52 68 ?? ?? ?? ?? e8 ?? ?? ?? ?? 83 c4 0c 85 c0 75 1b 8b 4d 18 51 53 8b 45 0c 50 8b c6 8a 55 08 52 8b d7 8b 4d d4 e8 ?? ?? ?? ?? eb 73"),
  pattern("6a 0b 8d 4d c8 51 68 ?? ?? ?? ?? e8 ?? ?? ?? ?? 83 c4 0c 85 c0 75 22 8b 45 18 50 53 8b 55 0c 8b c6 52 8b d7 80 7d 08 00 0f 95 c1 83 e1 01 51 8b 4d d4 e8 ?? ?? ?? ?? eb 3a")
];
const dimensions = [
  pattern("8b 45 10 e8 ?? ?? ?? ?? 8b d8 8b 45 10 e8 ?? ?? ?? ?? 89 45 c4 8b 45 10 e8 ?? ?? ?? ?? 89 45 bc 81 f3 ?? ?? ?? ?? 81 75 c4 ?? ?? ?? ?? 83 7d c0 03 74 40 83 7d c0 04"),
  pattern("8b 45 10 e8 ?? ?? ?? ?? 89 45 a0 8b 45 10 e8 ?? ?? ?? ?? 89 45 9c 81 75 a0 ?? ?? ?? ?? 81 75 9c ?? ?? ?? ?? 8b 45 10 e8 ?? ?? ?? ?? 89 45 98 8b 4d 9c 8b 55 a0 8b 45 ac ff 55 a8")
];
const matches = (bytes, at, shape, end) => at >= 0 && at + shape.length <= end &&
  shape.every((value, i) => value === null || bytes[at + i] === value);
const rawSuffix = Buffer.from("\0raw\x1a", "binary"), sds = Buffer.from("TLG0.0\0sds\x1a", "binary");
const prologue = pattern("55 8b ec 81 c4 ?? ?? ?? ?? 53 56 57");

function reader(bytes, pe, start, version) {
  const shape = dimensions[version], end = Math.min(start + 1024, pe.sectionAt(start).end), found = [];
  if (!matches(bytes, start, prologue, end) || bytes.readInt32LE(start + 5) >= 0 || bytes.readInt32LE(start + 5) < -1024 * 1024) {return null;}
  for (let at = start; at + shape.length <= end; at++) {
    if (!matches(bytes, at, shape, end)) {continue;}
    const calls = (version === 0 ? [3, 13, 24] : [3, 14, 39]).map(offset => pe.callTarget(at + offset));
    if (calls[0] === null || calls.some(target => target !== calls[0])) {continue;}
    found.push({widthXor: bytes.readUInt32LE(at + (version === 0 ? 34 : 25)),
      heightXor: bytes.readUInt32LE(at + (version === 0 ? 41 : 32)), read: calls[0]});
  }
  return found.length === 1 ? found[0] : null;
}

/** Recover only a connected PE32 TLG5/6 dispatch and its dimension readers. */
export function discoverNativeTlgProfiles(input) {
  if (!(input instanceof Uint8Array) || input.length > 64 * 1024 * 1024) {return [];}
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), pe = parsePe(bytes), found = new Map();
  if (!pe) {return [];}
  for (const section of pe.sections.filter(value => value.executable)) {
    for (let at = section.raw; at + dispatch[0].length + dispatch[1].length <= section.end; at++) {
      if (bytes[at] !== 0x6a || bytes[at + 1] !== 11) {continue;}
      const next = at + dispatch[0].length;
      if (!matches(bytes, at, dispatch[0], section.end) || !matches(bytes, next, dispatch[1], section.end)) {continue;}
      const compare = pe.callTarget(at + 11);
      if (compare === null || pe.callTarget(next + 11) !== compare) {continue;}
      const pair = [];
      for (const [version, position, call] of [[5, at, 43], [6, next, 50]]) {
        const signature = pe.fromVa(bytes.readUInt32LE(position + 7), 11), target = pe.callTarget(position + call);
        if (signature === null || target === null || !bytes.subarray(signature + 6, signature + 11).equals(rawSuffix)) {break;}
        const value = reader(bytes, pe, target, version - 5);
        if (!value || value.read === compare) {break;}
        pair.push({version, signature: bytes.subarray(signature, signature + 11).toString("hex"), ...value});
      }
      if (pair.length !== 2 || pair[0].read !== pair[1].read || pair[0].signature === pair[1].signature) {continue;}
      for (const item of pair) {
        const {version, signature, widthXor, heightXor} = item, value = {version, signature, widthXor, heightXor}, key = `${version}:${signature}`;
        requireFormat(!found.has(key) || JSON.stringify(found.get(key)) === JSON.stringify(value), "FILTER_AMBIGUOUS");
        found.set(key, value);
      }
      requireFormat(found.size <= 32, "MODULE_LIMIT");
    }
  }
  return [...found.values()];
}

function canonicalHeader(bytes, profiles) {
  const start = bytes.subarray(0, 11).equals(sds) ? 15 : 0;
  for (const profile of profiles) {
    if (!bytes.subarray(start, start + 11).equals(Buffer.from(profile.signature, "hex"))) {continue;}
    const offset = start + (profile.version === 5 ? 12 : 15), required = offset + 12;
    requireFormat(bytes.length >= required);
    const colors = bytes[start + 11];
    requireFormat(profile.version === 5 ? colors === 3 || colors === 4 :
      [1, 3, 4].includes(colors) && bytes.subarray(start + 12, start + 15).every(value => value === 0));
    const width = (bytes.readUInt32LE(offset) ^ profile.widthXor) >>> 0, height = (bytes.readUInt32LE(offset + 4) ^ profile.heightXor) >>> 0;
    requireFormat(width > 0 && width <= 0x7fffffff && height > 0 && height <= 0x7fffffff && bytes.readUInt32LE(offset + 8) > 0);
    if (start) {requireFormat(bytes.readUInt32LE(11) >= required - start);}
    bytes.write(`TLG${profile.version}.0`, start, "binary");
    bytes.writeUInt32LE(width, offset); bytes.writeUInt32LE(height, offset + 4); break;
  }
  return bytes;
}

/** Buffer at most 42 bytes; the caller authenticates decoded source separately. */
export async function* rewriteNativeTlg(chunks, profiles) {
  const prefix = Buffer.alloc(42); let used = 0, ready = false;
  for await (const bytes of chunks) {
    if (ready) {yield bytes; continue;}
    const count = Math.min(prefix.length - used, bytes.length);
    prefix.set(bytes.subarray(0, count), used); used += count;
    if (used === prefix.length) {
      yield canonicalHeader(prefix, profiles); ready = true;
      if (count < bytes.length) {yield bytes.subarray(count);}
    }
  }
  if (!ready && used) {yield canonicalHeader(prefix.subarray(0, used), profiles);}
}
