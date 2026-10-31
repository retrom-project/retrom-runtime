import {createHash} from "node:crypto";
import {inflate, maximumIndex, requireFormat} from "./bytes.mjs";
import {parsePe} from "./cxdec-pe.mjs";
import {decryptBres, validHxParams, hxDigest} from "./hxv4-crypto.mjs";

const text16 = bytes => new TextDecoder("utf-16le", {fatal: true, ignoreBOM: true}).decode(bytes);
function resources(bytes, pe) {
  const address = bytes.readUInt32LE(60), header = address + 24;
  if (bytes.readUInt16LE(address + 20) < 120) {return new Map();}
  const length = bytes.readUInt32LE(header + 116), rva = bytes.readUInt32LE(header + 112);
  if (!rva || !length) {return new Map();}
  const base = pe.fromVa(pe.imageBase + rva, length); requireFormat(base !== null && length <= maximumIndex);
  const result = new Map(), visited = new Set(); let count = 0;
  const at = (offset, size) => {requireFormat(offset >= 0 && offset + size <= length); return base + offset;};
  function walk(offset, path) {
    requireFormat(path.length <= 3 && !visited.has(offset)); visited.add(offset);
    const start = at(offset, 16), size = bytes.readUInt16LE(start + 12) + bytes.readUInt16LE(start + 14);
    requireFormat(size <= 4096 && count + size <= 8192, "MODULE_LIMIT"); count += size; at(offset + 16, size * 8);
    for (let i = 0; i < size; i++) {
      const p = start + 16 + i * 8, name = bytes.readUInt32LE(p), next = bytes.readUInt32LE(p + 4); let key = name;
      if (name & 0x80000000) {const n = name & 0x7fffffff, units = bytes.readUInt16LE(at(n, 2)); key = text16(bytes.subarray(at(n + 2, units * 2), at(n + 2, units * 2) + units * 2));}
      if (next & 0x80000000) {walk(next & 0x7fffffff, [...path, key]);}
      else {
        requireFormat(path.length === 2); const data = at(next, 16), bytesRva = bytes.readUInt32LE(data), sizeBytes = bytes.readUInt32LE(data + 4);
        const begin = pe.fromVa(pe.imageBase + bytesRva, sizeBytes); requireFormat(begin !== null && sizeBytes <= maximumIndex);
        const id = `${path[0]}/${path[1]}`;
        if (["10/STARTUP.TJS", "10/BOOTSTRAP", "TEXT/127"].includes(id)) {
          const value = bytes.subarray(begin, begin + sizeBytes); requireFormat(!result.has(id) || result.get(id).equals(value)); result.set(id, value);
        }
      }
    }
  }
  walk(0, []); return result;
}
/** Read only the typed DATA string pool; no TJS execution or decompilation. */
export function hxTjsStrings(bytes) {
  requireFormat(bytes.length >= 12 && bytes.subarray(0, 8).equals(Buffer.from("TJS2100\0")) && bytes.readUInt32LE(8) === bytes.length);
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(at + 4); requireFormat(size >= 8 && at + size <= bytes.length);
    if (bytes.toString("ascii", at, at + 4) !== "DATA") {at += size; continue;}
    const end = at + size; let p = at + 8;
    const read32 = () => {requireFormat(p + 4 <= end); const value = bytes.readUInt32LE(p); p += 4; return value;};
    const take = count => {requireFormat(count <= end - p); const result = bytes.subarray(p, p + count); p += Math.ceil(count / 4) * 4; requireFormat(p <= end); return result;};
    for (const unit of [1, 2, 4, 8, 8]) {take(read32() * unit);}
    const count = read32(), result = []; requireFormat(count <= 100000, "MODULE_LIMIT");
    for (let i = 0; i < count; i++) {const n = read32(); requireFormat(n <= 32767); result.push(text16(take(n * 2)));}
    return result;
  }
  throw new Error("RUNTIME_KIRIKIRI_HXV4_BOOTSTRAP_UNAVAILABLE");
}
function bresPath(url) {
  const match = /^bres:\/\/\.\/([a-z\d]+)(?:\/[a-z\d._-]+)*\/?$/iu.exec(url); requireFormat(match && match[1].length <= 256);
  return match[1];
}
function salts(bytes, pe) {
  const values = new Map();
  for (const section of pe.sections.filter(s => s.executable)) {
    for (let at = section.raw; at + 20 <= section.end; at++) {
      if (bytes[at] !== 0xc7 || bytes[at + 1] !== 5) {continue;}
      const salt = pe.fromVa(bytes.readUInt32LE(at + 6), 8192); if (salt === null) {continue;}
      for (let p = at + 10; p + 10 <= Math.min(section.end, at + 64); p++) {
        if (bytes[p] === 0xc7 && bytes[p + 1] === 5 && bytes.readUInt32LE(p + 6) === 8192) {values.set(salt, bytes.subarray(salt, salt + 8192)); break;}
      }
      requireFormat(values.size <= 32, "MODULE_LIMIT");
    }
  }
  return [...values.values()];
}
function config(bytes, tag, valid) {
  const marker = Buffer.from(tag + "\0"), found = new Map(); let cursor = 0;
  for (let attempts = 0; attempts < 64; attempts++) {
    const at = bytes.indexOf(marker, cursor); if (at < 0) {break;} cursor = at + 1;
    const p = at + marker.length; if (p + 2 > bytes.length) {continue;}
    const size = bytes.readUInt16LE(p); if (size > 32767 || p + 2 + size > bytes.length) {continue;}
    const value = bytes.subarray(p + 2, p + 2 + size); if (valid(value)) {found.set(value.toString("hex"), value);}
  }
  requireFormat(found.size === 1, "HXV4_BOOTSTRAP_UNAVAILABLE"); return [...found.values()][0];
}
function seeds(bytes, pe) {
  const result = new Map(), marker = Buffer.concat([Buffer.from("--xopt--no\0", "utf16le"), Buffer.alloc(2)]);
  const add = value => {if (value.length === 8 && value.some(v => v)) {result.set(value.toString("hex"), value);}};
  let cursor = 0;
  while (cursor < bytes.length) {const at = bytes.indexOf(marker, cursor); if (at < 0) {break;} add(bytes.subarray(at + marker.length, at + marker.length + 8)); cursor = at + marker.length;}
  for (const section of pe.sections.filter(s => s.executable)) {
    for (let p = section.raw; p + 80 <= section.end; p++) {
      if (bytes[p] !== 0xc7 || bytes[p + 1] !== 0x45 || bytes[p + 7] !== 0xc7 || bytes[p + 8] !== 0x45 ||
          bytes[p + 9] !== (bytes[p + 2] + 4 & 255) || !bytes.subarray(p + 14, p + 17).equals(Buffer.from([0x0f, 0x45, 0xf0]))) {continue;}
      const tail = bytes.subarray(p + 17, p + 80);
      if (tail.includes(Buffer.from([0xff, 0x36])) && tail.includes(Buffer.from([0x6a, 8])) && tail.includes(0x56) && tail.includes(0xe8)) {
        add(Buffer.concat([bytes.subarray(p + 3, p + 7), bytes.subarray(p + 10, p + 14)]));
      }
    }
  }
  requireFormat(result.size > 0 && result.size <= 32, "HXV4_BOOTSTRAP_UNAVAILABLE"); return [...result.values()];
}
function unkeyedHashers(bytes, pe) {
  // Supported constructor shape: vptr assignment, zero key_ptr/key_len, copy
  // at most 16/32 bytes into inline storage, then publish key_ptr only.
  // All literal addresses are recovered from the supplied PE's RTTI/vtables.
  return ["PathNameHashTrait", "FileNameHashTrait"].every(name => {
    const marker = Buffer.from(`.?AU?$DefaultCompoundHasher@U${name}@@@@\0`), typeAt = bytes.indexOf(marker);
    if (typeAt < 8) {return false;} const typeVa = pe.toVa(typeAt - 8), tables = new Set();
    for (let at = 12; at + 8 <= bytes.length; at += 4) {
      if (bytes.readUInt32LE(at) !== typeVa || bytes.readUInt32LE(at - 12) !== 0 || bytes.readUInt32LE(at - 8) !== 0) {continue;}
      const colVa = pe.toVa(at - 12); if (colVa === null) {continue;}
      for (let v = 0; v + 12 <= bytes.length; v += 4) {
        if (bytes.readUInt32LE(v) === colVa && pe.fromVa(bytes.readUInt32LE(v + 8), 1, true) !== null) {tables.add(pe.toVa(v + 4));}
      }
    }
    for (const section of pe.sections.filter(s => s.executable)) {
      for (let p = section.raw; p + 20 <= section.end; p++) {
        const m = bytes[p + 1], reg = m & 7;
        if (bytes[p] !== 0xc7 || m >> 3 !== 0 || reg >= 4 && reg <= 5 || !tables.has(bytes.readUInt32LE(p + 2))) {continue;}
        const zero = offset => bytes[p + offset] === 0xc7 && bytes[p + offset + 1] === (0x40 | reg) && bytes.readUInt32LE(p + offset + 3) === 0;
        if (zero(6) && bytes[p + 8] === 4 && zero(13) && bytes[p + 15] === 8) {return true;}
      }
    }
    return false;
  });
}
export function discoverHxBootstrap(bytes) {
  const pe = parsePe(bytes); if (!pe) {return null;}
  const rc = resources(bytes, pe), startup = rc.get("10/STARTUP.TJS"), bootstrap = rc.get("10/BOOTSTRAP"), root = rc.get("TEXT/127");
  if (!startup || !bootstrap || !root) {return null;}
  const rootPath = bresPath(text16(root).replace(/\0+$/u, "")); const accepted = [];
  for (const salt of salts(bytes, pe)) {
    const plain = decryptBres(startup, rootPath, salt); if (!plain.subarray(0, 8).equals(Buffer.from("TJS2100\0"))) {continue;}
    const strings = hxTjsStrings(plain), paths = [...new Set(strings.filter(s => /^bres:.*\/bootstrap\/?$/iu.test(s)).map(bresPath))];
    requireFormat(paths.length === 1, "HXV4_BOOTSTRAP_UNAVAILABLE");
    const packed = decryptBres(bootstrap, paths[0], salt); requireFormat(packed.length >= 8 && packed.readUInt32LE() === packed.length - 8);
    const dll = inflate(packed.subarray(8), packed.readUInt32LE(4)), native = parsePe(dll); requireFormat(native && unkeyedHashers(dll, native), "HXV4_HASHER_UNSUPPORTED");
    const params = config(dll, "PARAMS", validHxParams), warning = config(dll, "WARNING", v => v.length > 0 && v.every(b => b >= 32 && b <= 126)).toString("ascii");
    const printable = value => [...value].every(c => c.charCodeAt(0) >= 32);
    const unique = text16(config(dll, "UNIQUE", v => {try {return v.length > 0 && printable(text16(v));} catch {return false;}}));
    const prefixes = [...new Set([...strings.filter(s => s && s.length <= 4096 && printable(s)), unique])].sort((a, b) => b.length - a.length);
    requireFormat(prefixes.length <= 256, "MODULE_LIMIT");
    accepted.push({params, warning, unique, prefixes, seeds: seeds(dll, native), strings, bootstrapSha256: hxDigest(dll), startupSha256: hxDigest(plain),
      sourceModuleSha256: createHash("sha256").update(bytes).digest("hex")});
  }
  requireFormat(accepted.length === 1, "HXV4_BOOTSTRAP_UNAVAILABLE"); return accepted[0];
}
