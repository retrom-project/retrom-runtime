import {createHash} from "node:crypto";
import {crc32, deflateSync} from "node:zlib";

const hex = (value: string) => Buffer.from(value.replaceAll(" ", ""), "hex");
const align8 = (n: number) => (n + 7) & ~7;
const table = Uint8Array.from({length: 256}, (_, i) => (197 * i + 53) & 255);
function key(seed: Uint8Array) {
  const out: number[] = []; let p = 11;
  for (;;) {
    for (let i = 0; i < 4; i++) out.push(seed[(p + i) % 15]);
    p = (p + 12) % 15;
    if (p === 12) return out;
    out.push(seed[p], seed[p + 1], seed[p + 2]); p = (p + 11) % 15;
  }
}
// Independent inverse of the shipped format's byte rounds, used only to build
// small generated containers. No commercial game bytes or executable is kept.
function encryptBlock(bytes: Uint8Array, expanded: number[]) {
  const b = Buffer.from(bytes);
  for (let j = 3; j >= 0; j--) b[j + 4] ^= table[b[j] ^ expanded[56 + j]];
  for (let r = 7; r >= 0; r--) {
    const k = r * 7;
    b[0] ^= table[b[7] ^ expanded[k + 6]]; b[3] ^= table[b[6] ^ expanded[k + 5]];
    b[2] ^= table[b[4] ^ b[5]]; b[1] ^= table[b[4] ^ expanded[k + 4]];
    b[5] ^= table[b[1] ^ expanded[k + 1]]; b[6] ^= table[b[2] ^ expanded[k + 2]];
    b[4] ^= table[b[0] ^ expanded[k]]; b[7] ^= table[b[3] ^ expanded[k + 3]];
  }
  return b;
}
function encrypt(bytes: Uint8Array, expanded: number[]) {
  const output = Buffer.alloc(align8(bytes.length)); let previous = Buffer.alloc(8);
  Buffer.from(bytes).copy(output);
  for (let at = 0; at < output.length; at += 8) {
    const b = output.subarray(at, at + 8); for (let j = 0; j < 8; j++) b[j] ^= previous[j];
    previous = encryptBlock(b, expanded); previous.copy(output, at);
  }
  return output;
}
function checksum16(bytes: Uint8Array) {
  let value = 0;
  for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xa001 : 0);}
  return value;
}
function relative(bytes: Buffer, call: number, target: number) {bytes[call] = 0xe8; bytes.writeInt32LE(target - call - 5, call + 1);}
export interface Resource {name: string; bytes: Buffer; mode?: number; flags?: number}
export interface FixtureOptions {
  relocate?: boolean; invalidName?: boolean; hidden?: boolean; badCatalog?: boolean; injected?: boolean; expandedStage?: number;
  multiplePackages?: boolean; cycle?: boolean; duplicate?: boolean; externalMount?: boolean; resources?: Resource[];
}
function stageImage(options: FixtureOptions) {
  const image = Buffer.alloc(0x1800), base = options.relocate ? 0x63000000 : 0x52000000;
  image.write("STEELBOX"); image.writeUInt32LE(0x893, 8); image.writeUInt32LE(base, 28); image.writeUInt32LE(0x1400, 36);
  const decoder = 0x1000, catalog = 0x1100, strings = 0x200, stringOffset = options.relocate ? 173 : 77;
  const password = Buffer.from(options.relocate ? "different container password" : "synthetic package secret");
  const scramble = options.relocate ? 0x21a45e37 : 0x1e774389, token = ((stringOffset + scramble) ^ scramble) >>> 0;
  image[strings + stringOffset] = 153; let state = 153;
  for (const [i, v] of [...password, 0].entries()) {image[strings + stringOffset + i + 1] = v ^ state; state = (state >>> 1) | (state << 7 & 255);}
  const resolver = hex("8b742410 b800000000 31c6 29c6 81e6ffff0000 8db600000000 8b4c2414 8b064657 8a2630c4882746d0c8474975f358595f5ec3");
  resolver.writeUInt32LE(scramble, 5); resolver.writeUInt32LE(base + strings, 21); resolver.copy(image, decoder);
  const calls = hex("6a00 6800000000 8bf1 e800000000 8bf8 8d45b4 5057 e800000000 57e800000000 83c414 8d4db451 8d8d70ffffff e800000000");
  calls[1] = password.length + 1; calls.writeUInt32LE(token, 3); calls.copy(image, catalog);
  relative(image, catalog + 9, decoder); relative(image, catalog + 21, 0x1600); relative(image, catalog + 27, 0x1610); relative(image, catalog + 45, 0x1620);
  const entry = hex("558bec83ec0853568b75108b460425ff000420a3000000008b4e04c1e90780e10133db880d00000000f746040080000057895dfc74238b96ac0100008915000000008b86bc0100008b8ec00100008945fc890d00000000");
  entry.copy(image, 0x1400);
  const packed: number[] = [];
  for (let at = 0; at < image.length; at += 256) packed.push(0, 255, ...image.subarray(at, at + 256));
  const compressed = Buffer.alloc(4 + packed.length); compressed.writeUInt32LE(options.expandedStage ?? image.length); Buffer.from(packed).copy(compressed, 4);
  return {compressed, password};
}
export function sourcePE(options: FixtureOptions) {
  const bytes = Buffer.alloc(0x1800), base = options.relocate ? 0x600000 : 0x400000;
  bytes.write("MZ"); bytes.writeUInt32LE(0x80, 60); bytes.write("PE\0\0", 0x80, "binary");
  bytes.writeUInt16LE(0x14c, 0x84); bytes.writeUInt16LE(2, 0x86); bytes.writeUInt16LE(224, 0x94);
  bytes.writeUInt16LE(0x10b, 0x98); bytes.writeUInt32LE(base, 0x98 + 28); bytes.writeUInt32LE(0x200, 0x98 + 36);
  for (const [i, [name, rva, raw, size, flags]] of [[0, [".text", 0x1000, 0x200, 0x1000, 0x60000020]], [1, [".rdata", 0x3000, 0x1200, 0x600, 0x40000040]]] as const) {
    const p = 0x178 + i * 40; bytes.write(name, p); bytes.writeUInt32LE(size, p + 8); bytes.writeUInt32LE(rva, p + 12);
    bytes.writeUInt32LE(size, p + 16); bytes.writeUInt32LE(raw, p + 20); bytes.writeUInt32LE(flags, p + 36);
  }
  const mask = options.relocate ? 0x71335628 : 0x324589fa, data = 0x1220;
  for (let i = 0; i < 256; i++) bytes.writeUInt32LE((table[i] ^ (mask >> ((i + 1) % 31))) >>> 0, data + i * 4);
  const loop = hex("817df4000100007d2c8b45f483c00199b91f000000f7f98bcaba00000000d3fa8b45f4331485000000008b4df4889100000000ebc2");
  loop.writeUInt32LE(mask, 26); loop.writeUInt32LE(base + 0x3020, 38); loop.writeUInt32LE(base + 0x6000, 47); loop.copy(bytes, 0x240);
  const schema = hex("8b55e881c200000000528b450c83c01850e80000000083c4086a008b4de8518b550c83c21852e80000000083c40c6a008b45e80500000000508b4d0c83c11851e800000000");
  const seedOffset = options.relocate ? 400 : 368, second = seedOffset + 16, headerSize = second + 112;
  schema.writeUInt32LE(seedOffset, 5); schema[26] = seedOffset / 8; schema[47] = 14; schema.writeUInt32LE(second, 52); schema.copy(bytes, 0x400);
  relative(bytes, 0x400 + 17, 0x850); relative(bytes, 0x400 + 38, 0x900); relative(bytes, 0x400 + 64, 0x900);
  const fields = hex("8b55108b42008945f48b4d108b5100528b450c50e80000000083c408");
  fields[5] = options.relocate ? 76 : 36; fields[14] = fields[5] - 4; fields.copy(bytes, 0x500); relative(bytes, 0x500 + 20, 0x950);
  const magic = hex("8b55c881f2000000003355c481fa000000007406b9068a27cfcc");
  magic.writeUInt32LE(0x41424344, 5); magic.writeUInt32LE(0x434f4e54, 14); magic.copy(bytes, 0x600);
  return {bytes, seedOffset, second, headerSize, stageFields: fields[14], magic: (0x41424344 ^ 0x434f4e54) >>> 0};
}
function metadata(resources: Resource[], blockStarts: number[]) {
  const bytes = Buffer.alloc(65536); let at = 4; const records: number[] = [];
  function node(name: string, entries: Resource[], directory: boolean) {
    const encoded = Buffer.from(name + "\0", "utf16le"), nameOffset = at; encoded.copy(bytes, at); at += encoded.length;
    const record = at; records.push(record);
    const count = directory ? entries.length : Math.ceil(entries[0].bytes.length / 49152);
    at += 52 + count * (directory ? 4 : 12);
    bytes.writeUInt32LE(name ? nameOffset : 0, record + 8); bytes.writeUInt32LE(name.length, record + 12);
    bytes.writeUInt32LE(directory ? 0x80000000 : entries[0].flags ?? 6, record + 40); bytes.writeUInt32LE(count, record + 48);
    return record;
  }
  const leafRecords = resources.map((resource, index) => {
    const off = node(resource.name, [resource], false), blockCount = Math.ceil(resource.bytes.length / 49152);
    bytes.writeUInt32LE(resource.bytes.length, off + 44);
    let start = blockStarts[index];
    for (let i = 0; i < blockCount; i++) {
      const plain = resource.bytes.subarray(i * 49152, (i + 1) * 49152), mode = resource.mode ?? 6;
      const packed = mode & 2 ? deflateSync(plain) : plain, size = mode & 4 ? align8(packed.length) : packed.length, p = off + 52 + i * 12;
      bytes.writeUInt16LE(size, p); bytes.writeUInt16LE(plain.length, p + 2); bytes.writeUInt16LE(mode, p + 4);
      bytes.writeUInt16LE(checksum16(plain), p + 6); bytes.writeUInt32LE(start, p + 8); start += size;
    }
    return off;
  });
  const folder = node("resources", resources, true);
  leafRecords.forEach((off, i) => bytes.writeUInt32LE(off, folder + 52 + i * 4));
  const root = node("", resources.slice(0, 1), true); bytes.writeUInt32LE(folder, root + 52);
  const list = at; for (const off of [...records].filter(off => off !== root).reverse()) {bytes.writeUInt32LE(off, at); at += 4;}
  return {bytes: bytes.subarray(0, align8(at)), root, list, count: records.length - 1};
}
function keyedMarker(seed: Uint8Array) {
  const repeated = Array.from({length: 60}, (_, i) => seed[i % 15]);
  const inverse = (input: Buffer) => {
    const out = Buffer.from(input);
    for (let r = 0; r < 8; r++) {
      const k = r * 7;
      out[7] ^= table[out[3] ^ repeated[k + 3]]; out[4] ^= table[out[0] ^ repeated[k]];
      out[6] ^= table[out[2] ^ repeated[k + 2]]; out[5] ^= table[out[1] ^ repeated[k + 1]];
      out[1] ^= table[out[4] ^ repeated[k + 4]]; out[2] ^= table[out[4] ^ out[5]];
      out[3] ^= table[out[6] ^ repeated[k + 5]]; out[0] ^= table[out[7] ^ repeated[k + 6]];
    }
    for (let j = 0; j < 4; j++) out[j + 4] ^= table[out[j] ^ repeated[56 + j]];
    return out;
  };
  return inverse(inverse(Buffer.from("STELPACK")));
}
function packResources(resources: Resource[], base: number, seed: Buffer, options: FixtureOptions = {}) {
  const expanded = key(seed), parts: Buffer[] = [Buffer.alloc(12)], starts: number[] = []; let offset = 12;
  for (const resource of resources) {
    starts.push(offset);
    for (let at = 0; at < resource.bytes.length; at += 49152) {
      let bytes = resource.bytes.subarray(at, at + 49152); const mode = resource.mode ?? 6;
      if (mode & 2) bytes = deflateSync(bytes);
      if (mode & 4) bytes = encrypt(bytes, expanded);
      parts.push(bytes); offset += bytes.length;
    }
  }
  const tree = metadata(resources, starts);
  if (options.cycle) tree.bytes.writeUInt32LE(tree.root, tree.root + 52);
  const footerOffset = base + offset + tree.bytes.length, header = Buffer.alloc(48);
  header.writeUInt32LE(footerOffset - tree.bytes.length); header.writeUInt32LE(tree.bytes.length, 4);
  header.writeUInt32LE(tree.root, 8); header.writeUInt32LE(footerOffset - base, 12); header.writeUInt32LE(crc32(tree.bytes), 16);
  header.writeUInt32LE(tree.list, 20); header.writeUInt32LE(tree.count, 24); keyedMarker(seed).copy(header, 40);
  return {bytes: Buffer.concat([...parts, encrypt(tree.bytes, expanded), encrypt(header, expanded)]), footerOffset, starts};
}
export function fixture(options: FixtureOptions = {}) {
  const pe = sourcePE(options), stage = stageImage(options);
  const seed = Uint8Array.from({length: 16}, (_, i) => (i * 19 + (options.relocate ? 23 : 101)) & 255), expanded = key(seed);
  const payload = encrypt(stage.compressed, expanded), header = Buffer.alloc(pe.headerSize);
  header.writeUInt32LE(0x8014, 4); header.writeUInt32LE(options.injected ? 7 : 0, 20);
  const stageOffset = pe.bytes.length + 8 + header.length, packageBase = stageOffset + payload.length;
  header.writeUInt32LE(stageOffset, pe.stageFields); header.writeUInt32LE(payload.length, pe.stageFields + 4); Buffer.from(seed.subarray(0, 15)).copy(header, pe.seedOffset);
  const resources: Resource[] = options.resources ?? [{name: options.invalidName ? "..\\outside" : "boot.ks", bytes: Buffer.from("fixture start"), flags: options.hidden ? 7 : 6},
    {name: options.duplicate ? "BOOT.KS" : "notes.txt", bytes: Buffer.from("plain text"), mode: 0}, {name: "large.bin", bytes: Buffer.alloc(60001, 31), mode: 4}];
  const packageSeeds = [createHash("md5").update("another seed, no title").digest()];
  const packages = [packResources(resources, packageBase, packageSeeds[0], options)];
  if (options.multiplePackages) {
    packageSeeds.push(createHash("md5").update("second package with its own key").digest());
    packages.push(packResources([{name: "boot.ks", bytes: Buffer.from("later package wins")}],
      packageBase + packages[0].bytes.length, packageSeeds[1]));
  }
  const count = packages.length, mounts = 16 + 8 * count, stringOffset = mounts + 24 * count + 1;
  const catalog = Buffer.alloc(80 + (count - 1) * 32);
  catalog.writeUInt32LE(16); catalog.writeUInt32LE(count, 4); catalog.writeUInt32LE(mounts, 8); catalog.writeUInt32LE(count, 12);
  catalog[stringOffset - 1] = 7; catalog.write("default", stringOffset);
  for (let i = 0; i < count; i++) {
    catalog.writeUInt32LE(packages[i].footerOffset, 16 + i * 8); catalog.writeUInt32LE(stringOffset, 20 + i * 8);
    catalog.writeUInt32LE(options.externalMount ? 0 : 1, mounts + i * 24); catalog.writeUInt32LE(stringOffset, mounts + i * 24 + 4);
    packageSeeds[i].copy(catalog, mounts + i * 24 + 8);
  }
  const catalogKey = key(createHash("md5").update(stage.password).digest()), catFooter = Buffer.alloc(8);
  catFooter.writeUInt32LE(catalog.length); catFooter.writeUInt32LE((crc32(catalog) ^ (options.badCatalog ? 1 : 0)) >>> 0, 4);
  const encodedCatalog = encrypt(catalog, catalogKey), catalogOffset = packages.at(-1)!.footerOffset + 48 + catalog.length;
  header.writeUInt32LE(catalogOffset, 444);
  const encodedHeader = Buffer.from(header); encrypt(header.subarray(0, pe.seedOffset), expanded).copy(encodedHeader);
  encrypt(header.subarray(pe.second), expanded).copy(encodedHeader, pe.second);
  const marker = Buffer.alloc(8); marker.writeUInt32LE(0xa12f4e71); marker.writeUInt32LE((0xa12f4e71 ^ pe.magic) >>> 0, 4);
  return {bytes: Buffer.concat([pe.bytes, marker, encodedHeader, payload, ...packages.map(p => p.bytes), encodedCatalog, encryptBlock(catFooter, catalogKey)]),
    resources, corruptBlockAt: packageBase + packages[0].starts[0]};
}
