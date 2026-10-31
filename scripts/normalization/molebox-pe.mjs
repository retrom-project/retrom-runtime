import {moleboxLimits, requireMolebox, moleboxRange, readMoleboxAt, moleboxKey, decodeMolebox, unpackMoleboxStage} from "./molebox-codec.mjs";

const match = (bytes, at, pattern) => at >= 0 && at + pattern.length <= bytes.length &&
  pattern.every((byte, i) => byte === null || bytes[at + i] === byte);
function find(bytes, pattern, start = 0, end = bytes.length) {
  const positions = [];
  for (let at = start; at + pattern.length <= end; at++) {
    if (match(bytes, at, pattern)) {positions.push(at); requireMolebox(positions.length <= 8, "RUNTIME_MOLEBOX_UNSUPPORTED");}
  }
  return positions;
}
const call = (bytes, at) => bytes[at] === 0xe8 ? at + 5 + bytes.readInt32LE(at + 1) : -1;
function one(values) {requireMolebox(values.length === 1, "RUNTIME_MOLEBOX_UNSUPPORTED"); return values[0];}

async function peLayout(handle, size, signal) {
  if (size < 64) {return null;}
  const dos = await readMoleboxAt(handle, size, 0, 64, signal);
  if (dos.toString("ascii", 0, 2) !== "MZ") {return null;}
  const offset = dos.readUInt32LE(60);
  if (offset < 64 || offset > Math.min(size - 24, 1024 * 1024)) {return null;}
  const head = await readMoleboxAt(handle, size, offset, 24, signal), count = head.readUInt16LE(6), optional = head.readUInt16LE(20);
  if (head.readUInt32LE() !== 0x4550 || head.readUInt16LE(4) !== 0x14c || !count || count > 96 || optional < 64 ||
      optional > 4096 || offset + 24 + optional + count * 40 > size) {return null;}
  const rest = await readMoleboxAt(handle, size, offset + 24, optional + count * 40, signal);
  if (rest.readUInt16LE() !== 0x10b) {return null;}
  const imageBase = rest.readUInt32LE(28), alignment = rest.readUInt32LE(36), sections = [];
  if (alignment < 512 || alignment > 65536 || (alignment & (alignment - 1))) {return null;}
  for (let i = 0; i < count; i++) {
    const p = optional + i * 40, raw = rest.readUInt32LE(p + 20), length = rest.readUInt32LE(p + 16), rva = rest.readUInt32LE(p + 12);
    if (raw > size || length > size - raw || rva + length > 0x100000000 || length && raw < offset + 24 + optional + count * 40 ||
        sections.some(s => length && s.length && (raw < s.end && s.raw < raw + length || rva < s.rva + s.length && s.rva < rva + length))) {return null;}
    sections.push({raw, length, end: raw + length, rva, executable: Boolean(rest.readUInt32LE(p + 36) & 0x20000000)});
  }
  const backed = sections.filter(s => s.length);
  if (!backed.length) {return null;}
  const last = backed.at(-1), overlay = Math.ceil(last.end / alignment) * alignment;
  if (backed.some(s => s.end > last.end) || overlay > size) {return null;}
  const fromVA = (va, length = 1) => {
    const section = sections.find(s => va >= imageBase + s.rva && va + length <= imageBase + s.rva + s.length);
    return section ? section.raw + va - imageBase - section.rva : -1;
  };
  return {imageBase, sections, overlay, fromVA};
}

// These are instruction vocabularies of the supported PE32 loader, with
// addresses, keys, offsets and branch displacements left as data. They are
// matched statically; no instruction or extracted executable is run.
function substitution(bytes, pe) {
  const pattern = [0x81, 0x7d, null, 0, 1, 0, 0, 0x7d, null, 0x8b, 0x45, null, 0x83, 0xc0, 1, 0x99,
    0xb9, 31, 0, 0, 0, 0xf7, 0xf9, 0x8b, 0xca, 0xba, null, null, null, null, 0xd3, 0xfa,
    0x8b, 0x45, null, 0x33, 0x14, 0x85, null, null, null, null, 0x8b, 0x4d, null, 0x88, 0x91, null, null, null, null, 0xeb, null];
  const values = [];
  for (const s of pe.sections.filter(s => s.executable)) for (const at of find(bytes, pattern, s.raw, s.end)) {
    if (![11, 34, 44].every(i => bytes[at + i] === bytes[at + 2]) || at + 53 + bytes.readInt8(at + 52) !== at - 9) {continue;}
    const raw = pe.fromVA(bytes.readUInt32LE(at + 38), 1024);
    if (raw < 0) {continue;}
    const mask = bytes.readUInt32LE(at + 26), table = Uint8Array.from({length: 256}, (_, i) => bytes[raw + 4 * i] ^ ((mask >> ((i + 1) % 31)) & 255));
    if (new Set(table).size === 256) {values.push({at, table, tableRaw: raw, mask});}
  }
  return values;
}
function headerSchema(bytes, pe) {
  const pattern = [0x8b, 0x55, null, 0x81, 0xc2, null, null, null, null, 0x52, 0x8b, 0x45, null, 0x83, 0xc0, 24,
    0x50, 0xe8, null, null, null, null, 0x83, 0xc4, 8, 0x6a, null, 0x8b, 0x4d, null, 0x51, 0x8b, 0x55, null,
    0x83, 0xc2, 24, 0x52, 0xe8, null, null, null, null, 0x83, 0xc4, 12, 0x6a, null, 0x8b, 0x45, null, 5,
    null, null, null, null, 0x50, 0x8b, 0x4d, null, 0x83, 0xc1, 24, 0x51, 0xe8, null, null, null, null];
  return pe.sections.filter(s => s.executable).flatMap(s => find(bytes, pattern, s.raw, s.end)).filter(at =>
    bytes[at + 2] === bytes[at + 29] && bytes[at + 2] === bytes[at + 50] &&
    call(bytes, at + 38) === call(bytes, at + 64) && [17, 38].every(p => {
      const target = call(bytes, at + p); return pe.sections.some(s => s.executable && target >= s.raw && target < s.end);
    })).map(at => ({at, seedOffset: bytes.readUInt32LE(at + 5), firstBytes: bytes[at + 26] * 8,
      secondOffset: bytes.readUInt32LE(at + 52), secondBytes: bytes[at + 47] * 8}));
}
function sourceSchema(bytes, pe) {
  const tables = substitution(bytes, pe), schemas = headerSchema(bytes, pe);
  if (!tables.length && !schemas.length) {return null;}
  requireMolebox(tables.length && schemas.length, "RUNTIME_MOLEBOX_UNSUPPORTED");
  const table = one(tables), header = one(schemas);
  const magic = one(find(bytes, [0x8b, 0x55, null, 0x81, 0xf2, null, null, null, null, 0x33, 0x55, null,
    0x81, 0xfa, null, null, null, null, 0x74, 6, 0xb9, null, null, null, null, 0xcc]).filter(p => Math.abs(p - header.at) < 4096));
  const fields = one(find(bytes, [0x8b, 0x55, null, 0x8b, 0x42, null, 0x89, 0x45, null, 0x8b, 0x4d, null,
    0x8b, 0x51, null, 0x52, 0x8b, 0x45, null, 0x50, 0xe8, null, null, null, null, 0x83, 0xc4, 8])
    .filter(p => Math.abs(p - header.at) < 4096 && bytes[p + 5] === bytes[p + 14] + 4));
  const size = header.secondOffset + header.secondBytes;
  requireMolebox(header.firstBytes > 0 && header.firstBytes <= header.seedOffset && header.seedOffset + 15 <= header.secondOffset &&
    size >= 492 && size <= 4096 && bytes[fields + 14] + 8 <= header.firstBytes, "RUNTIME_MOLEBOX_UNSUPPORTED");
  return {...header, ...table, headerBytes: size, stageField: bytes[fields + 14],
    magic: (bytes.readUInt32LE(magic + 5) ^ bytes.readUInt32LE(magic + 14)) >>> 0};
}
function stringParameters(stage, target, imageBase) {
  const pattern = [0x8b, 0x74, 0x24, null, 0xb8, null, null, null, null, 0x31, 0xc6, 0x29, 0xc6, 0x81, 0xe6, 255, 255, 0, 0,
    0x8d, 0xb6, null, null, null, null, 0x8b, 0x4c, 0x24, null, 0x8b, 6, 0x46, 0x57, 0x8a, 0x26, 0x30, 0xc4,
    0x88, 0x27, 0x46, 0xd0, 0xc8, 0x47, 0x49, 0x75, 0xf3, 0x58, 0x59, 0x5f, 0x5e, 0xc3];
  const at = one(find(stage, pattern, Math.max(0, target), Math.min(stage.length, target + 128)));
  const base = stage.readUInt32LE(at + 21) - imageBase;
  requireMolebox(base >= 0 && base < stage.length, "RUNTIME_MOLEBOX_UNSUPPORTED");
  return {base, scramble: stage.readUInt32LE(at + 5)};
}
function catalogPassword(stage, imageBase) {
  const pattern = [0x6a, null, 0x68, null, null, null, null, 0x8b, 0xf1, 0xe8, null, null, null, null,
    0x8b, 0xf8, 0x8d, 0x45, null, 0x50, 0x57, 0xe8, null, null, null, null, 0x57, 0xe8, null, null, null, null,
    0x83, 0xc4, 20, 0x8d, 0x4d, null, 0x51, 0x8d, 0x8d, null, null, null, null, 0xe8, null, null, null, null];
  const at = one(find(stage, pattern)), {base, scramble} = stringParameters(stage, call(stage, at + 9), imageBase);
  const length = stage[at + 1], token = stage.readUInt32LE(at + 3), offset = base + (((token ^ scramble) - scramble) & 65535);
  requireMolebox(length >= 2 && length <= 128);
  const bytes = moleboxRange(stage, offset, length + 1), password = Buffer.alloc(length); let state = bytes[0];
  for (let i = 0; i < length; i++) {password[i] = bytes[i + 1] ^ state; state = (state >>> 1) | ((state & 1) << 7);}
  requireMolebox(password[length - 1] === 0 && !password.subarray(0, -1).includes(0));
  return password.subarray(0, -1);
}
function stageParameters(stage, header) {
  requireMolebox(stage.length >= 52 && stage.toString("ascii", 0, 8) === "STEELBOX" && stage.readUInt32LE(8) === 0x893,
    "RUNTIME_MOLEBOX_UNSUPPORTED");
  const imageBase = stage.readUInt32LE(28), entry = stage.readUInt32LE(36);
  requireMolebox(entry >= 52 && entry < stage.length && imageBase + stage.length <= 0x100000000);
  const positions = find(stage, [0x8b, 0x86, null, null, null, null, 0x8b, 0x8e, null, null, null, null, 0x89, 0x45, null],
    entry, Math.min(entry + 160, stage.length));
  const field = stage.readUInt32LE(one(positions) + 2);
  requireMolebox(field >= 0 && field + 8 <= header.length && stage.readUInt32LE(positions[0] + 8) === field + 4);
  const marker = find(stage, [0xf7, 0x46, 4, 0, 0x80, 0, 0], entry, Math.min(entry + 128, stage.length));
  requireMolebox(marker.length === 1 && header.readUInt32LE(4) & 0x8000, "RUNTIME_MOLEBOX_UNSUPPORTED");
  return {catalogOffset: header.readUInt32LE(field), password: catalogPassword(stage, imageBase)};
}

export async function readMoleboxLoader(handle, size, signal) {
  const pe = await peLayout(handle, size, signal);
  if (!pe || size - pe.overlay < 8) {return null;}
  // A PE image that exceeds the bounded static recognition window is not yet
  // a matched container. Never apply Molebox-specific limits to an ordinary EXE.
  if (pe.overlay > moleboxLimits.image) {return null;}
  const bytes = await readMoleboxAt(handle, size, 0, pe.overlay, signal), schema = sourceSchema(bytes, pe);
  if (!schema) {return null;}
  const marker = await readMoleboxAt(handle, size, pe.overlay, 8, signal);
  requireMolebox(((marker.readUInt32LE() ^ marker.readUInt32LE(4)) >>> 0) === schema.magic);
  const raw = await readMoleboxAt(handle, size, pe.overlay + 8, schema.headerBytes, signal), key = moleboxKey(moleboxRange(raw, schema.seedOffset, 15));
  const header = Buffer.from(raw);
  decodeMolebox(raw.subarray(0, schema.firstBytes), key, schema.table).copy(header);
  decodeMolebox(raw.subarray(schema.secondOffset), key, schema.table).copy(header, schema.secondOffset);
  const flags = header.readUInt32LE(4);
  requireMolebox(!header.readUInt32LE(20) && !header.readUInt32LE(60) && !(flags & 0x20000),
    "RUNTIME_MOLEBOX_INJECTION_UNSUPPORTED");
  requireMolebox((flags & 0x10) !== 0 && !(flags & 0x80000000), "RUNTIME_MOLEBOX_UNSUPPORTED");
  const stageOffset = header.readUInt32LE(schema.stageField), packed = header.readUInt32LE(schema.stageField + 4);
  requireMolebox(stageOffset >= pe.overlay + 8 + raw.length && packed > 0 && packed % 8 === 0);
  requireMolebox(packed <= moleboxLimits.stage, "RUNTIME_MOLEBOX_LIMIT");
  const encoded = await readMoleboxAt(handle, size, stageOffset, packed, signal);
  const stage = unpackMoleboxStage(decodeMolebox(encoded, key, schema.table), signal), params = stageParameters(stage, header);
  return {...params, table: schema.table, dataStart: stageOffset + packed,
    evidence: {kind: "molebox4-steelbox", overlayOffset: pe.overlay, loaderTableOffset: schema.tableRaw, stageOffset, stageBytes: stage.length}};
}

