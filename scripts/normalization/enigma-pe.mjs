import {createHash} from "node:crypto";
import {enigmaCrypt, enigmaSchedule, enigmaDepack, enigmaLimits, enigmaRange, requireEnigma, readEnigma} from "./enigma-codec.mjs";

const match = (b, at, pattern) => at >= 0 && at + pattern.length <= b.length && pattern.every((v, i) => v === null || b[at + i] === v);
const md5 = b => createHash("md5").update(b).digest();
export async function enigmaLayout(handle, size, signal) {
  if (size < 64) {return null;}
  const dos = await readEnigma(handle, size, 0, 64, signal), nt = dos.readUInt32LE(60);
  if (dos.toString("ascii", 0, 2) !== "MZ" || nt < 64 || nt > Math.min(size - 24, 1024 * 1024)) {return null;}
  const head = await readEnigma(handle, size, nt, 24, signal), count = head.readUInt16LE(6), optional = head.readUInt16LE(20);
  if (head.readUInt32LE() !== 0x4550 || head.readUInt16LE(4) !== 0x14c || !count || count > 96 || optional < 96 ||
      optional > 4096 || nt + 24 + optional + count * 40 > size) {return null;}
  const rest = await readEnigma(handle, size, nt + 24, optional + count * 40, signal);
  if (rest.readUInt16LE() !== 0x10b) {return null;}
  const sections = [];
  for (let i = 0; i < count; i++) {
    const at = optional + 40 * i, raw = rest.readUInt32LE(at + 20), length = rest.readUInt32LE(at + 16);
    if (raw > size || length > size - raw) {return null;}
    sections.push({raw, length, rva: rest.readUInt32LE(at + 12), virtual: rest.readUInt32LE(at + 8), flags: rest.readUInt32LE(at + 36)});
  }
  // Protector's reserved loader section can have a raw size larger than its
  // virtual allocation. Resolve RVAs by the last owning virtual section.
  const fromRva = (rva, length = 1) => {
    const section = sections.findLast(s => rva >= s.rva && rva < s.rva + s.virtual);
    return section && length <= section.length - (rva - section.rva) ? section.raw + rva - section.rva : -1;
  };
  const directories = Math.min(rest.readUInt32LE(92), Math.floor((optional - 96) / 8));
  const directory = index => index < directories ? {rva: rest.readUInt32LE(96 + 8 * index), size: rest.readUInt32LE(100 + 8 * index)} : null;
  return {sections, fromRva, entry: rest.readUInt32LE(16), imageBase: rest.readUInt32LE(28), directory};
}
function decodeBootstrap(bytes, entry) {
  if (!match(bytes, 10, [0x60, 0xe8, 0, 0, 0, 0, 0x5d, 0x81, 0xed, 16, 0, 0, 0, 0x81, 0xed]) || bytes.readUInt32LE(25) !== entry) {return null;}
  const decoded = Buffer.from(bytes), visited = new Set(); let changed = true;
  while (changed) {
    changed = false;
    for (let at = 29; at + 33 <= decoded.length; at++) {
      if (visited.has(at) || !match(decoded, at, [0xb8, null, null, null, null, 3, 0xc5, 0x81, 0xc0,
        null, null, null, null, 0xb9, null, null, null, null, 0xba, null, null, null, null, 0x30, 0x10, 0x40, 0x49, 0x0f, 0x85, 0xf6, 255, 255, 255]) || decoded.readUInt32LE(at + 1) !== entry) {continue;}
      const start = decoded.readUInt32LE(at + 9), size = decoded.readUInt32LE(at + 14), key = decoded[at + 19];
      requireEnigma(visited.size < 8 && start >= at + 33 && size > 0 && size <= decoded.length - start, "UNSUPPORTED");
      for (let i = start; i < start + size; i++) {decoded[i] ^= key;}
      visited.add(at); changed = true;
    }
  }
  requireEnigma(visited.size > 0, "UNSUPPORTED");
  const handoffs = [], loaders = [];
  for (let at = 0; at < decoded.length; at++) {
    if (match(decoded, at, [0x54, 0x64, 0xff, 0x35, 0, 0, 0, 0, 0x68, null, null, null, null,
      0x55, 0x56, 0x8b, 0x46, 0x3c, 0x8b, 0x84, 0x30, 0x28, 0, 0, 0, 3, 0xc6, 0xff, 0xe0])) {handoffs.push(decoded.readUInt32LE(at + 9));}
    if (match(decoded, at, [0x8b, 0xcd, 0x8b, 0x89, 0x3c, 0, 0, 0, 0x81, 0xc1, 0xf8, 0, 0, 0, 3, 0xcd,
      0xb8, null, null, null, null, 0xba, 0x28, 0, 0, 0, 0xf7, 0xe2, 3, 0xc8, 0x8b, 0x81, 12, 0, 0, 0, 3, 0xc5])) {loaders.push(decoded.readUInt32LE(at + 17));}
  }
  requireEnigma(handoffs.length === 1 && loaders.length === 1, "UNSUPPORTED");
  return {configRva: handoffs[0], loaderSection: loaders[0], xorStages: visited.size, decoded};
}
function settings(config) {
  let at = 16;
  const word = () => {const value = enigmaRange(config, at, 4).readUInt32LE(); at += 4; return value;};
  const skip = size => {enigmaRange(config, at, size); at += size;};
  const restore = word(); word(); skip(restore);
  for (const width of [80, 20]) {const count = word(); requireEnigma(count <= enigmaLimits.entries, "LIMIT"); skip(count * width);}
  const entries = word(); requireEnigma(entries > 0 && entries <= 96, "UNSUPPORTED"); skip((entries - 1) * 8 + 8);
  skip(0xdc + 0x88);
  const fields = enigmaRange(config, at, 0xf5d0), field = offset => offset - 0x328;
  requireEnigma(config.length === at + fields.length, "UNSUPPORTED");
  requireEnigma(fields[field(0xb078)] === 1 && fields[field(0xb07a)] <= 1, "UNSUPPORTED");
  return {headerState: Buffer.from(fields.subarray(field(0xb081), field(0xb081) + 256)),
    payloadState: Buffer.from(fields.subarray(field(0xb081) + 256, field(0xb081) + 512)),
    compressed: Boolean(fields[field(0xb07a)]), packageOffset: fields.readUInt32LE(field(0xb488)), packageSize: fields.readUInt32LE(field(0xb484))};
}
/** Recognize the connected self-decoder/configuration vocabulary; no x86 execution. */
export async function enigmaPE(handle, size, signal) {
  const pe = await enigmaLayout(handle, size, signal);
  if (!pe) {return null;}
  const entryAt = pe.fromRva(pe.entry, 80);
  if (entryAt < 0) {return null;}
  const section = pe.sections.findLast(s => pe.entry >= s.rva && pe.entry < s.rva + s.virtual);
  const bytes = await readEnigma(handle, size, entryAt, Math.min(enigmaLimits.bootstrap, section.raw + section.length - entryAt), signal);
  const bootstrap = decodeBootstrap(bytes, pe.entry);
  if (!bootstrap) {return null;}
  const configAt = pe.fromRva(bootstrap.configRva, 28);
  requireEnigma(configAt >= 0 && bootstrap.loaderSection < pe.sections.length, "UNSUPPORTED");
  const header = await readEnigma(handle, size, configAt, 28, signal), count = header.readUInt32LE(), packed = header.readUInt32LE(4), expanded = header.readUInt32LE(8);
  requireEnigma(count > 0 && count <= pe.sections.length && packed > 0 && packed <= enigmaLimits.metadata && expanded <= enigmaLimits.metadata, "LIMIT");
  requireEnigma(pe.fromRva(bootstrap.configRva + 28, packed) === configAt + 28);
  const source = await readEnigma(handle, size, configAt + 28, packed, signal);
  requireEnigma(md5(source).equals(header.subarray(12, 28)));
  const key = Buffer.alloc(16); let hashed = 0;
  for (const s of pe.sections.slice(0, count)) {
    if (s.flags & 0x10000000) {continue;}
    requireEnigma((hashed += s.length) <= 64 * 1024 * 1024, "LIMIT");
    const digest = md5(await readEnigma(handle, size, s.raw, s.length, signal));
    for (let i = 0; i < 16; i++) {key[i] ^= digest[i];}
  }
  const config = enigmaDepack(enigmaCrypt(source, enigmaSchedule(key)), expanded, signal);
  requireEnigma(config.length >= 16 && md5(config.subarray(16)).equals(config.subarray(0, 16)));
  const recovered = settings(config), base = pe.sections[bootstrap.loaderSection].raw + recovered.packageOffset;
  requireEnigma(recovered.packageSize >= 120 && recovered.packageSize <= size - base);
  return {...recovered, base, protectedConfiguration: {bootstrap: bootstrap.decoded, entryRva: pe.entry, fromRva: pe.fromRva,
    masterConfig: config, loaderVirtualSize: pe.sections[bootstrap.loaderSection].virtual}, evidence: {entryRva: pe.entry, configRva: bootstrap.configRva,
    xorStages: bootstrap.xorStages, hashedSections: count, configurationBytes: config.length}};
}
