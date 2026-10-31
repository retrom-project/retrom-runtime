import {Buffer} from "node:buffer";
export const generatedProfile = (salt = 0) => ({archiveName: `translation-${salt}.bin`, key: Buffer.from(Array.from({length: 1024}, (_, i) => (i * 73 + salt * 37 + 19) & 255)),
  headerXors: {version: (0x12345678 + salt) >>> 0, count: (0x23456789 + salt) >>> 0, packed: (0x3456789a + salt) >>> 0, raw: (0x456789ab + salt) >>> 0},
  hashSeed: (0x98765432 + salt) >>> 0, payloadMagic: (0x76543210 + salt) >>> 0, rotation: 2, startMarker: 0xfffffffe, endMarker: 0xffffffff});
export function marked(text: string) {
  return Buffer.concat([Buffer.from("feffffff", "hex"), Buffer.from(Buffer.from(text).map(x => (x << 2 | x >> 6) & 255)), Buffer.from("ffffffff", "hex")]);
}
export function psb(strings = [Buffer.from("caption"), marked("中文对白"), Buffer.concat([Buffer.from("prefix "), marked("保留原文"), Buffer.from(" suffix")])]) {
  const names = Buffer.from([13, 0, 13]), nodes = Buffer.from([0x21, 13, 0, 13, 0]), table = Buffer.alloc(4 + strings.length * 4), data = Buffer.concat(strings.map(s => Buffer.concat([s, Buffer.from([0])])));
  table[0] = 14; table.writeUInt16LE(strings.length, 1); table[3] = 16;
  let at = 0; strings.forEach((s, i) => {table.writeUInt32LE(at, 4 + i * 4); at += s.length + 1;});
  const header = Buffer.alloc(40); header.write("PSB\0"); header.writeUInt16LE(2, 4); header.writeUInt32LE(40, 8);
  header.writeUInt32LE(40, 12); header.writeUInt32LE(40 + names.length + nodes.length, 16); header.writeUInt32LE(header.readUInt32LE(16) + table.length, 20);
  const chunks = header.readUInt32LE(20) + data.length; header.writeUInt32LE(chunks, 24); header.writeUInt32LE(chunks + 3, 28); header.writeUInt32LE(chunks + 6, 32); header.writeUInt32LE(40 + names.length, 36);
  return Buffer.concat([header, names, nodes, table, data, Buffer.from([13, 0, 13, 13, 0, 13]), Buffer.from("resource bytes")]);
}
export function literalLz4(data: Buffer) {
  const extra: number[] = []; let n = data.length - 15;
  if (n >= 0) {while (n >= 255) {extra.push(255); n -= 255;} extra.push(n);}
  return Buffer.concat([Buffer.from([Math.min(15, data.length) << 4, ...extra]), data]);
}
export function payload(data: Buffer, profile = generatedProfile()) {
  const header = Buffer.alloc(8); header.writeUInt32LE(profile.payloadMagic); header.writeUInt32LE(data.length, 4);
  return Buffer.from(Buffer.concat([header, literalLz4(data)]).map((v, i) => v ^ profile.key[i & 1023]));
}
export function stringsOf(data: Buffer) {
  const p = data.readUInt32LE(16), start = data.readUInt32LE(20), count = data.readUInt16LE(p + 1);
  return Array.from({length: count}, (_, i) => {const off = start + data.readUInt32LE(p + 4 + i * 4); return data.subarray(off, data.indexOf(0, off)).toString("utf8");});
}

// Escape-only CHuffman packets independently encode arbitrary metadata as
// runs of literal bytes; no production decompressor participates in fixtures.
export function huffmanLiterals(data: Buffer) {
  const bits: number[] = [];
  const write = (value: number, count: number) => {for (let i = 0; i < count; i++) bits.push(value >>> i & 1);};
  write(0, 8); write(1, 8); write(0, 1);
  const header = Buffer.alloc(Math.floor(bits.length / 8) + 1);
  bits.forEach((bit, i) => {header[i >>> 3] |= bit << (i & 7);}); bits.length = 0;
  for (let at = 0; at < data.length; at += 15) {
    const run = data.subarray(at, at + 15); write(0, 1); write(run.length, 4); for (const byte of run) write(byte, 8);
  }
  const body = Buffer.alloc(Math.ceil(bits.length / 8)); bits.forEach((bit, i) => {body[i >>> 3] |= bit << (i & 7);});
  const size = Buffer.alloc(4); size.writeUInt32LE(data.length); return Buffer.concat([header, size, body]);
}
export function archive(options: {salt?: number; duplicate?: boolean; invalidName?: boolean; badHash?: boolean} = {}) {
  const salt = options.salt ?? 0, profile = generatedProfile(salt), content = payload(psb(), profile), name = options.invalidName ? "../escape" : "intro.ks.scn", encoded = Buffer.from(name + "\0", "utf16le");
  const row = Buffer.alloc(24); row.writeUInt32LE(0x12345678);
  const [lo, hi] = salt === 73 ? [0xedd296db, 0x9bb536aa] : [0x24494af9, 0x25ad5099];
  row.writeUInt32LE(options.badHash ? lo ^ 1 : lo, 4); row.writeUInt32LE(hi, 8); row.writeUInt32LE(24, 12); row.writeUInt32LE(content.length, 16); row.writeUInt32LE(name.length, 20);
  const item = Buffer.concat([row, encoded]), indexRaw = Buffer.concat(Array.from({length: options.duplicate ? 2 : 1}, () => item)), index = huffmanLiterals(indexRaw), header = Buffer.alloc(24);
  header.writeUInt32LE(1 ^ profile.headerXors.version, 4); header.writeUInt32LE(24 + content.length, 8);
  header.writeUInt32LE((options.duplicate ? 2 : 1) ^ profile.headerXors.count, 12);
  header.writeUInt32LE(index.length ^ profile.headerXors.packed, 16); header.writeUInt32LE(indexRaw.length ^ profile.headerXors.raw, 20);
  return {profile, header, index, content, bytes: Buffer.concat([header, content, index])};
}

const hex = (value: string) => Buffer.from(value.replaceAll(" ", ""), "hex");
export function companion(options: {salt?: number; subtract?: number; imageBase?: number; brokenReference?: boolean} = {}) {
  const profile = generatedProfile(options.salt ?? 0), bytes = Buffer.alloc(0x5400), imageBase = options.imageBase ?? 0x31000000, raw = 0x400, rva = 0x1000;
  const va = (offset: number) => imageBase + rva + offset - raw;
  bytes.write("MZ"); bytes.writeUInt32LE(0x80, 60); bytes.write("PE\0\0", 0x80, "binary"); bytes.writeUInt16LE(0x14c, 0x84); bytes.writeUInt16LE(2, 0x86); bytes.writeUInt16LE(224, 0x94);
  bytes.writeUInt16LE(0x10b, 0x98); bytes.writeUInt32LE(imageBase, 0x98 + 28); bytes.writeUInt32LE(0x6100, 0x98 + 96);
  for (const [i, [sectionRva, sectionRaw, size]] of [[0, [rva, raw, 0x4000]], [1, [0x6000, 0x4400, 0x1000]]] as const) {
    const at = 0x178 + i * 40; bytes.writeUInt32LE(size, at + 8); bytes.writeUInt32LE(sectionRva, at + 12); bytes.writeUInt32LE(size, at + 16); bytes.writeUInt32LE(sectionRaw, at + 20); bytes.writeUInt32LE(0xe0000020, at + 36);
  }
  bytes.writeUInt32LE(1, 0x4500 + 20); bytes.writeUInt32LE(0x6150, 0x4500 + 28); bytes.writeUInt32LE(0x1100, 0x4550);
  const loop = hex("8b56048bc881e1000000008a8900000000300c02403b0672e753578b7e04813f00000000"); loop.writeUInt32LE(1023, 7); loop.writeUInt32LE(options.brokenReference ? 0x1000 : va(0x2000), 13); loop.writeUInt32LE(profile.payloadMagic, 32); loop.copy(bytes, 0x500);
  bytes[0x550] = 0xe8; bytes.writeInt32LE(0x1100 - 0x550 - 5, 0x551);
  hex("0fb61e46895df8c1eb0483fb0f").copy(bytes, 0x1170);
  profile.key.copy(bytes, 0x2000); Buffer.from(profile.archiveName + "\0", "utf16le").copy(bytes, 0x2500);
  const open = hex("6a0068800000006a036a006a0168000000806800000000"); open.writeUInt32LE(va(0x2500), 19); open.copy(bytes, 0x980);
  const schema = hex("8b8500ffffff81b5fcfeffff00000000350000000081b5f8feffff0000000081b5f0feffff00000000");
  schema.writeUInt32LE(profile.headerXors.packed, 12); schema.writeUInt32LE(profile.headerXors.raw, 17); schema.writeUInt32LE(profile.headerXors.count, 27); schema.writeUInt32LE(profile.headerXors.version, 37); schema.copy(bytes, 0xa00);
  const hash = hex("558bec83ec0853568bda8bf15781f30000000033ff895dfc83fa08"); hash.writeUInt32LE(profile.hashSeed, 15); hash.copy(bytes, 0xe00); hex("69c095e9d15b69c095e9d15b").copy(bytes, 0xe40);
  const rotate = hex("8a8100000000c0c802888100000000413bca72ec"); rotate.writeUInt32LE(va(0x3000), 2); rotate.writeUInt32LE(va(0x3000), 11); rotate.copy(bytes, 0xf00);
  hex("833c37fe").copy(bytes, 0xe90); hex("833c37ff").copy(bytes, 0xec0);
  if (options.subtract !== undefined) for (let at = raw; at < raw + 0x4000; at += 4) bytes.writeUInt32LE((bytes.readUInt32LE(at) + options.subtract) >>> 0, at);
  return {bytes, profile};
}
