import {createHash} from "node:crypto";

const u32 = (n: number) => {const b = Buffer.alloc(4); b.writeUInt32LE(n); return b;};
const u64 = (n: number) => {const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b;};
const hash = (b: Buffer) => createHash("md5").update(b).digest();
function stream(bytes: Buffer, input: Buffer) {
  const s = Buffer.from(input), out = Buffer.alloc(bytes.length); let i = 0, j = 0;
  for (let p = 0; p < bytes.length; p++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[p] = bytes[p] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
function schedule(key: Buffer) {
  const s = Buffer.from(Array.from({length: 256}, (_, i) => i)); let j = 0;
  for (let i = 0; i < 256; i++) {j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]];}
  return s;
}
// Literal-only aPLib encoding, independent of the production decoder.
function literals(bytes: Buffer) {
  const out = [bytes[0]]; let slot = 0, remaining = 0;
  const bit = (value: number) => {
    if (!remaining) {slot = out.length; out.push(0); remaining = 8;}
    remaining--; out[slot] |= value << remaining;
  };
  for (let i = 1; i < bytes.length; i++) {bit(0); out.push(bytes[i]);}
  bit(1); bit(1); bit(0); out.push(0);
  return Buffer.from(out);
}
export function enigmaPackage(state: Buffer | null, payload = Buffer.from("virtual contents"), name = "assets/story.txt", options: {compressed?: boolean; timestamp?: number} = {}) {
  const crypt = (b: Buffer) => state ? stream(b, state.subarray(0, 256)) : b;
  const record = (id: number, kind: number, children: number, name: string, extra = Buffer.alloc(0)) => {
    const body = Buffer.concat([u32(id), u32(id ? id === 1 ? 1 : 2 : 0), u32(children), Buffer.from(name + "\0", "utf16le"), Buffer.from([kind]), extra]);
    return Buffer.concat([crypt(u32(body.length)), crypt(body)]);
  };
  const components = name.split("/");
  const dirs = components.slice(0, -1).map((part, i) => record(i + 2, 3, 1, part, Buffer.alloc(29)));
  const root = record(0, 0, 1, ""), domain = record(1, 3, 1, "%DEFAULT FOLDER%", Buffer.alloc(29));
  const body: Buffer[] = [], tables: Buffer[] = [];
  const blockSize = options.compressed ? 65536 : 8192;
  let position = options.compressed ? Math.ceil(payload.length / blockSize) * 12 : 0;
  for (let at = 0; at < payload.length; at += blockSize) {
    const block = payload.subarray(at, at + blockSize), packed = options.compressed ? literals(block) : block;
    if (options.compressed) {
      const table = Buffer.concat([u64(position), u32(packed.length)]);
      tables.push(state ? stream(table, state.subarray(256, 512)) : table); position += packed.length;
    }
    body.push(state ? stream(packed, state.subarray(256, 512)) : packed);
  }
  const stored = Buffer.concat([...tables, ...body]);
  const file = record(components.length + 2, 2, 0, components.at(-1)!, Buffer.concat([
    Buffer.from([0, 0]), u64(payload.length), Buffer.alloc(24), u32(32), Buffer.from([0, 0, 0]), u64(stored.length)]));
  const size = 120 + root.length + domain.length + dirs.reduce((s, b) => s + b.length, 0) + file.length + stored.length;
  const first = Buffer.alloc(56), second = Buffer.alloc(64);
  first.writeUInt32LE(30); first.writeBigUInt64LE(BigInt(size - 56), 48);
  second.writeUInt32LE(64, 4); second.writeUInt32LE(1, 16); second.writeUInt32LE(1, 20);
  second.writeDoubleLE(options.timestamp ?? 0, 8);
  second.writeBigUInt64LE(120n, 24); second.writeBigUInt64LE(BigInt(size - 120), 32); second.writeBigUInt64LE(BigInt(size), 48);
  return Buffer.concat([crypt(first), crypt(second), root, domain, ...dirs, file, stored]);
}
export function protectedEnigma(options: {relocate?: boolean; path?: string; large?: boolean; compressed?: boolean} = {}) {
  const state = Buffer.from(Array.from({length: 1024}, (_, i) => (i * 43 + (i >>> 8) * 7) & 255));
  const payload = Buffer.from(options.large ? "across block boundaries\n".repeat(6000) : "translated resource\n");
  const pkg = enigmaPackage(state, payload, options.path, {compressed: options.compressed});
  const packageRaw = 0x600, entryRaw = Math.ceil((packageRaw + pkg.length) / 512) * 512;
  const entryRva = options.relocate ? 0x120000 : 0x80000, configRva = entryRva + 0x300, configRaw = entryRaw + 0x300;
  const config = Buffer.alloc(0x20 + 12 + 0xdc + 0x88 + 0xf5d0);
  config.writeUInt32LE(1, 0x20); // one entry-location record (12 bytes)
  const settings = 0x20 + 12 + 0xdc + 0x88;
  state.copy(config, settings + 0xb081 - 0x328);
  config.writeUInt32LE(pkg.length, settings + 0xb484 - 0x328);
  config[settings + 0xb078 - 0x328] = 1;
  config[settings + 0xb07a - 0x328] = options.compressed ? 1 : 0;
  hash(config.subarray(16)).copy(config);
  const packed = literals(config), firstSection = Buffer.alloc(512, options.relocate ? 83 : 45);
  const encrypted = stream(packed, schedule(hash(firstSection))), header = Buffer.concat([u32(1), u32(encrypted.length), u32(config.length), hash(encrypted)]);
  const bytes = Buffer.alloc(configRaw + header.length + encrypted.length);
  bytes.write("MZ"); bytes.writeUInt32LE(0x80, 60); bytes.write("PE\0\0", 0x80);
  bytes.writeUInt16LE(0x14c, 0x84); bytes.writeUInt16LE(3, 0x86); bytes.writeUInt16LE(224, 0x94); bytes.writeUInt16LE(0x10b, 0x98);
  bytes.writeUInt32LE(entryRva, 0xa8); bytes.writeUInt32LE(0x400000, 0xb4);
  const section = (i: number, raw: number, size: number, rva: number) => {
    const at = 0x178 + i * 40; bytes.writeUInt32LE(size, at + 8); bytes.writeUInt32LE(rva, at + 12);
    bytes.writeUInt32LE(size, at + 16); bytes.writeUInt32LE(raw, at + 20); bytes.writeUInt32LE(0xe0000040, at + 36);
  };
  section(0, 0x400, 512, 0x1000); section(1, packageRaw, pkg.length, 0x3000);
  section(2, entryRaw, bytes.length - entryRaw, entryRva); firstSection.copy(bytes, 0x400); pkg.copy(bytes, packageRaw);
  const entry = Buffer.alloc(0x280); Buffer.from("eb08004c4d000000000060e8000000005d81ed1000000081ed", "hex").copy(entry);
  entry.writeUInt32LE(entryRva, 25);
  // Supported self-decoder, with a variable body extent/key and a connected loader section selector.
  entry[29] = 0xe9; entry.writeUInt32LE(4, 30); entry[37] = 0xb8; entry.writeUInt32LE(entryRva, 38);
  Buffer.from("03c581c0", "hex").copy(entry, 42); entry.writeUInt32LE(76, 46);
  entry[50] = 0xb9; entry.writeUInt32LE(0x200, 51); entry[55] = 0xba; entry.writeUInt32LE(0x734b527a, 56);
  Buffer.from("301040490f85f6ffffffe904000000", "hex").copy(entry, 60);
  Buffer.from("8bcd8b893c00000081c1f800000003cdb8", "hex").copy(entry, 80);
  entry.writeUInt32LE(1, 97); Buffer.from("ba28000000f7e203c88b810c00000003c5", "hex").copy(entry, 101);
  const handoff = Buffer.concat([Buffer.from("5464ff350000000068", "hex"), u32(configRva), Buffer.from("55568b463c8b84302800000003c6ffe0", "hex")]);
  handoff.copy(entry, 180);
  for (let i = 76; i < 76 + 0x200; i++) {entry[i] ^= 0x7a;}
  entry.copy(bytes, entryRaw); header.copy(bytes, configRaw); encrypted.copy(bytes, configRaw + header.length);
  return {bytes, payload, name: options.path ?? "assets/story.txt", state, configRaw, packageRaw};
}
