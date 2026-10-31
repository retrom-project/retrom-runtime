/* global Buffer */
// Synthetic PE/container protocol fixture. No original game or native module bytes.
import {createCipheriv} from "node:crypto";
import {deflateSync} from "node:zlib";
import {chunk, uint64, magic, adler32} from "../scripts/kirikiri/bytes.mjs";
import {deriveHxMaterial, decryptBres} from "../scripts/kirikiri/hxv4-crypto.mjs";
import {createHxManager, applyHxState} from "../scripts/kirikiri/hxv4-filter.mjs";
import {hxPathHash, hxFileHash} from "../scripts/kirikiri/hxv4-names.mjs";

const params = Buffer.from("00010203040506070001020304050102000134127856", "hex");
const prefix = "Synthetic Bootstrap (C) Test.", warning = "Warning! synthetic author rights.", unique = "{SyntheticUnique}";
const seed = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), media = "synthetic", base = 0x10000000;
const va = (offset        ) => base + (offset < 0x2400 ? 0x1000 + offset - 0x400 : 0x4000 + offset - 0x2400);
function pe() {
  const bytes = Buffer.alloc(0x11400); bytes.write("MZ"); bytes.writeUInt32LE(0x80, 60); bytes.write("PE\0\0", 0x80, "binary");
  bytes.writeUInt16LE(0x14c, 0x84); bytes.writeUInt16LE(2, 0x86); bytes.writeUInt16LE(0xe0, 0x94);
  bytes.writeUInt16LE(0x10b, 0x98); bytes.writeUInt32LE(base, 0xb4);
  for (const [at, rva, size, raw, flags] of [[0x178, 0x1000, 0x2000, 0x400, 0x60000020], [0x1a0, 0x4000, 0xf000, 0x2400, 0x40000040]]) {
    bytes.writeUInt32LE(size, at + 8); bytes.writeUInt32LE(rva, at + 12); bytes.writeUInt32LE(size, at + 16); bytes.writeUInt32LE(raw, at + 20); bytes.writeUInt32LE(flags, at + 36);
  }
  return bytes;
}
function dll() {
  const bytes = pe();
  let at = 0x2600;
  for (const [name, value] of [["PARAMS", params], ["WARNING", Buffer.from(warning)], ["UNIQUE", Buffer.from(unique, "utf16le")]]         ) {
    const marker = Buffer.from(name + "\0"); marker.copy(bytes, at); at += marker.length; bytes.writeUInt16LE(value.length, at); at += 2; value.copy(bytes, at); at += value.length;
  }
  ["PathNameHashTrait", "FileNameHashTrait"].forEach((name, i) => {
    const type = 0x2c00 + i * 0x100, col = 0x2e00 + i * 0x40, table = 0x2f00 + i * 0x40, code = 0x500 + i * 0x100;
    bytes.write(`.?AU?$DefaultCompoundHasher@U${name}@@@@\0`, type + 8, "ascii"); bytes.writeUInt32LE(va(type), col + 12);
    bytes.writeUInt32LE(va(col), table); bytes.writeUInt32LE(va(0x1300), table + 4); bytes.writeUInt32LE(va(0x1310), table + 8);
    bytes[0x1300] = 0xc3; bytes[0x1310] = 0xc3;
    const vptr = Buffer.alloc(4); vptr.writeUInt32LE(va(table + 4));
    Buffer.from([0xc7, 6, ...vptr, 0xc7, 0x46, 4, 0, 0, 0, 0, 0xc7, 0x46, 8, 0, 0, 0, 0, 0x8b, 0xc6, 0xc2, 4, 0]).copy(bytes, code);
  });
  Buffer.from([0xc7, 0x45, 0xe0, ...seed.subarray(0, 4), 0xc7, 0x45, 0xe4, ...seed.subarray(4), 0x0f, 0x45, 0xf0,
    0xff, 0x36, 0x6a, 8, 0x56, 0xe8, 0, 0, 0, 0]).copy(bytes, 0x800);
  return bytes;
}
function tjs(strings          ) {
  const items           = [Buffer.alloc(20), Buffer.alloc(4)]; items[1].writeUInt32LE(strings.length);
  for (const text of strings) {
    const value = Buffer.from(text, "utf16le"), n = Buffer.alloc(4); n.writeUInt32LE(text.length);
    items.push(n, value, Buffer.alloc((4 - value.length % 4) % 4));
  }
  items.push(Buffer.alloc(4)); const data = Buffer.concat(items), header = Buffer.alloc(12), field = Buffer.alloc(8);
  header.write("TJS2100\0", 0, "binary"); header.writeUInt32LE(20 + data.length, 8); field.write("DATA"); field.writeUInt32LE(data.length + 8, 4);
  return Buffer.concat([header, field, data]);
}
                                                                
function addResources(bytes        , tree              ) {
  const start = 0x4000; let cursor = 0;
  const allocate = (size        ) => {const at = cursor; cursor += Math.ceil(size / 4) * 4; return at;};
  function node(rows              )         {
    const list = [...rows].sort(([a], [b]) => Number(typeof b === "string") - Number(typeof a === "string")), at = allocate(16 + rows.size * 8);
    bytes.writeUInt16LE(list.filter(([name]) => typeof name === "string").length, start + at + 12);
    bytes.writeUInt16LE(list.filter(([name]) => typeof name === "number").length, start + at + 14);
    list.forEach(([name, child], i) => {
      let nameId        ;
      if (typeof name === "string") {
        const stringAt = allocate(2 + name.length * 2); bytes.writeUInt16LE(name.length, start + stringAt); bytes.write(name, start + stringAt + 2, "utf16le"); nameId = (0x80000000 | stringAt) >>> 0;
      } else {nameId = name;}
      const p = start + at + 16 + i * 8; bytes.writeUInt32LE(nameId, p);
      if (child instanceof Map) {bytes.writeUInt32LE((0x80000000 | node(child)) >>> 0, p + 4);}
      else {
        const leaf = allocate(16), content = allocate(child.length); bytes.writeUInt32LE(leaf, p + 4);
        bytes.writeUInt32LE(va(start + content) - base, start + leaf); bytes.writeUInt32LE(child.length, start + leaf + 4); child.copy(bytes, start + content);
      }
    });
    return at;
  }
  node(tree); bytes.writeUInt32LE(va(start) - base, 0x108); bytes.writeUInt32LE(cursor, 0x10c);
}
function executable(native        ) {
  const bytes = pe(), salt = Buffer.from(Array.from({length: 8192}, (_, i) => i * 37 & 255)); salt.copy(bytes, 0x9000);
  const word = (value        ) => {const b = Buffer.alloc(4); b.writeUInt32LE(value); return b;};
  Buffer.from([0xc7, 5, ...word(va(0xb100)), ...word(va(0x9000)), 0xc7, 5, ...word(va(0xb104)), 0, 0x20, 0, 0, 0xc3]).copy(bytes, 0x650);
  const startup = tjs([prefix, "bres://./native/bootstrap", media, "startup.tjs"]), zipped = deflateSync(native);
  const packed = Buffer.concat([word(zipped.length), word(native.length), zipped]);
  const lang = (value        )               => new Map([[1033, value]]);
  const tree               = new Map();
  tree.set("TEXT", new Map([[127, lang(Buffer.from("bres://./initial/\0", "utf16le"))]]));
  tree.set(10, new Map([["STARTUP.TJS", lang(decryptBres(startup, "initial", salt))], ["BOOTSTRAP", lang(decryptBres(packed, "native", salt))]]));
  addResources(bytes, tree); return bytes;
}
const i32 = (value        ) => {const b = Buffer.alloc(4); b.writeInt32BE(value); return b;};
const array = (items          ) => Buffer.concat([Buffer.from([0x81]), i32(items.length), ...items]);
const octet = (value        ) => Buffer.concat([Buffer.from([3]), i32(value.length), value]);
const integer = (value        ) => {const b = Buffer.alloc(9); b[0] = 4; b.writeBigInt64BE(BigInt.asIntN(64, value), 1); return b;};
function seal(input        , key        , nonce        ) {
  const rotate = (v        , n        ) => (v << n | v >>> (32 - n)) >>> 0;
  const x = [...Array.from(Buffer.from("expand 32-byte k")), ...key, ...nonce.subarray(0, 16)];
  const state = Array.from({length: 16}, (_, i) => Buffer.from(x).readUInt32LE(i * 4));
  const quarter = (a        , b        , c        , d        ) => {
    state[a] = state[a] + state[b] >>> 0; state[d] = rotate(state[d] ^ state[a], 16);
    state[c] = state[c] + state[d] >>> 0; state[b] = rotate(state[b] ^ state[c], 12);
    state[a] = state[a] + state[b] >>> 0; state[d] = rotate(state[d] ^ state[a], 8);
    state[c] = state[c] + state[d] >>> 0; state[b] = rotate(state[b] ^ state[c], 7);
  };
  for (let i = 0; i < 10; i++) {quarter(0, 4, 8, 12); quarter(1, 5, 9, 13); quarter(2, 6, 10, 14); quarter(3, 7, 11, 15); quarter(0, 5, 10, 15); quarter(1, 6, 11, 12); quarter(2, 7, 8, 13); quarter(3, 4, 9, 14);}
  const subkey = Buffer.alloc(32); [0, 1, 2, 3, 12, 13, 14, 15].forEach((index, i) => subkey.writeUInt32LE(state[index], i * 4));
  const encoder = createCipheriv("chacha20-poly1305", subkey, Buffer.concat([Buffer.alloc(4), nonce.subarray(16)]), {authTagLength: 16});
  const ciphertext = Buffer.concat([encoder.update(input), encoder.final()]); return Buffer.concat([encoder.getAuthTag(), ciphertext]);
}
function fakeName(id        ) {let value = id, name = ""; do {name += String.fromCharCode(0x5000 + (value & 0x3fff)); value >>>= 14;} while (value); return name;}
export function hxFixture() {
  const material = deriveHxMaterial(params, prefix, warning, unique, seed), manager = createHxManager(material);
  const resources = ["startup.tjs", "system/initialize.tjs", "misc/other.bin"].map((name, i) => ({name, id: [23, 0x4003, 2][i], key: BigInt(i + 3) * 0xabcdef01234567n,
    local: i & 1, bytes: Buffer.from(Array.from({length: 70001 + i * 13}, (_, n) => (n * 17 + i * 31) & 255))}));
  const groups = resources.map(r => {
    const [dir, name] = r.name.includes("/") ? [r.name.slice(0, r.name.lastIndexOf("/") + 1), r.name.slice(r.name.lastIndexOf("/") + 1)] : ["", r.name];
    return [octet(hxPathHash(dir, media)), array([octet(hxFileHash(name, media)), array([integer(BigInt(r.local) << 32n | BigInt(r.id)), integer(r.key)])])];
  });
  const table = array(groups.reverse().flat()), size = Buffer.alloc(4); size.writeUInt32LE(table.length);
  const payload = seal(Buffer.concat([size, deflateSync(table)]), material.key, material.nonce1), rows           = [], bodies           = []; let offset = 19;
  for (const r of resources) {
    const body = applyHxState(Buffer.from(r.bytes), 0, manager.state(r.key, r.local)), name = Buffer.from(fakeName(r.id), "utf16le"), info = Buffer.alloc(22), segment = Buffer.alloc(28), checksum = Buffer.alloc(4);
    info.writeUInt32LE(0x80000000); info.writeBigUInt64LE(BigInt(body.length), 4); info.writeBigUInt64LE(BigInt(body.length), 12); info.writeUInt16LE(name.length / 2, 20);
    segment.writeBigUInt64LE(BigInt(offset), 4); segment.writeBigUInt64LE(BigInt(body.length), 12); segment.writeBigUInt64LE(BigInt(body.length), 20); checksum.writeUInt32LE(adler32(r.bytes));
    bodies.push(body); rows.push(chunk("File", Buffer.concat([chunk("info", Buffer.concat([info, name])), chunk("segm", segment), chunk("adlr", checksum)]))); offset += body.length;
  }
  const descriptor = Buffer.alloc(14); descriptor.writeBigUInt64LE(BigInt(offset)); descriptor.writeUInt32LE(payload.length, 8); descriptor.writeUInt16LE(1, 12);
  const index = Buffer.concat([chunk("Hxv4", descriptor), ...rows]);
  const archive = Buffer.concat([magic, uint64(offset + payload.length), ...bodies, payload, Buffer.from([0]), uint64(index.length), index]);
  return {exe: executable(dll()), archive, resources, media};
}
