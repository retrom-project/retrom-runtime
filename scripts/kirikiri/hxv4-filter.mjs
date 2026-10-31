import {requireFormat} from "./bytes.mjs";
import {validHxParams} from "./hxv4-crypto.mjs";

// Native flat DripValue VM / bounded generator, cross-checked with the supplied
// PE and xp3-brute 0.3.7 (MIT), hxv4_native.rs, eb71626801afd3d86ade797489b984b5cda20582.
const mask64 = (1n << 64n) - 1n, u64 = value => value & mask64;
const rol64 = (v, n) => u64(v << BigInt(n) | v >> BigInt(64 - n));
function splitmix(value) {
  let v = u64((value ^ value >> 30n) * 0xbf58476d1ce4e5b9n);
  v = u64((v ^ v >> 27n) * 0x94d049bb133111ebn); return u64(v ^ v >> 31n);
}
function random(lane, type) {
  const base = BigInt(~lane >>> 0) << 32n | BigInt(lane), gamma = 0x9e3779b97f4a7c15n;
  let a = splitmix(u64(base + gamma)), b = splitmix(u64(base + 2n * gamma));
  return () => {
    const value = type ? u64(rol64(u64(a * 5n), 7) * 9n) : u64(rol64(u64(a + b), 17) + a);
    b ^= a; a = u64(rol64(a, type ? 24 : 49) ^ b ^ b << BigInt(type ? 16 : 21)); b = rol64(b, type ? 37 : 28);
    return Number(value & 0xffffffffn);
  };
}
const unary = ["not", "neg", "inc", "dec", "shuffle", "xor", "add", "table"];
const binary = ["addScratch", "subScratch", "scratchMinus", "mul", "shl", "shr"];
class Generator {
  constructor(params, next) {this.params = params; this.next = next; this.length = 0; this.code = [];}
  add(size) {if (this.length + size > 128) {return false;} this.length += size; return true;}
  emit(op, value = 0) {this.code.push({op, value});}
  leaf() {
    const index = this.params.subarray(14, 17).indexOf(this.next() % 3);
    if (index === 1) {if (!this.add(2)) {return false;} this.emit("seed"); return true;}
    if (!this.add(index === 0 ? 1 : 7)) {return false;}
    const value = this.next(); if (!this.add(4)) {return false;}
    this.emit(index === 0 ? "immediate" : "tableImmediate", index === 0 ? value : value & 1023); return true;
  }
  branch(depth) {return this.next() & 1 ? this.binary(depth) : this.unary(depth);}
  binary(depth) {
    if (depth <= 1) {return this.leaf();}
    if (!this.add(1)) {return false;} this.emit("enter");
    if (!this.branch(depth - 1) || !this.add(2)) {return false;} this.emit("store");
    if (!this.branch(depth - 1)) {return false;}
    const index = this.params.subarray(8, 14).indexOf(this.next() % 6);
    if (!this.add([2, 2, 4, 3, 9, 9][index]) || !this.add(1)) {return false;}
    this.emit(binary[index]); this.emit("stop"); return true;
  }
  unary(depth) {
    if (depth <= 1) {return this.leaf();}
    if (!this.branch(depth - 1)) {return false;}
    const index = this.params.subarray(0, 8).indexOf(this.next() & 7), op = unary[index];
    if (index === 6) {
      const add = this.next() & 1;
      if (!this.add(1)) {return false;} const value = this.next(); if (!this.add(4)) {return false;}
      this.emit(add ? "add" : "sub", value); return true;
    }
    if (!this.add([2, 2, 1, 1, 21, 1, 0, 13][index])) {return false;}
    let value = 0;
    if (index === 5) {value = this.next(); if (!this.add(4)) {return false;}}
    this.emit(op, value); return true;
  }
}
function lane(params, id) {
  const next = random(id, params[17] >>> 7);
  // Failed attempts retain the PRNG state; only their emitted vector is reset.
  for (let depth = 5; depth >= 1; depth--) {
    const builder = new Generator(params, next);
    if (builder.add(9) && builder.binary(depth) && builder.add(6)) {builder.emit("stop"); return builder.code;}
  }
  throw new Error("RUNTIME_KIRIKIRI_HXV4_VM_INVALID");
}
const operations = {
  add: (r, s, v) => r + v, sub: (r, s, v) => r - v, xor: (r, s, v) => r ^ v,
  addScratch: (r, s) => r + s, subScratch: (r, s) => r - s, scratchMinus: (r, s) => s - r,
  mul: (r, s) => Math.imul(r, s), shl: (r, s) => r << (s & 15), shr: (r, s) => r >>> (s & 15),
  shuffle: r => (r & 0x55555555) * 2 | (0x55555555 & r >>> 1),
  not: r => ~r, neg: r => -r, inc: r => r + 1, dec: r => r - 1,
  immediate: (r, s, v) => v, seed: (r, s, v, input) => input,
  tableImmediate: (r, s, v, input, table) => table[v], table: (r, s, v, input, table) => table[r & 1023],
};
function evaluate(code, input, table, state = {pc: 0, scratch: 0, value: 0}, depth = 0) {
  requireFormat(depth <= 6, "HXV4_VM_INVALID");
  while (state.pc < code.length) {
    const {op, value} = code[state.pc++];
    if (op === "stop") {return state.value;}
    if (op === "enter") {
      const scratch = state.scratch; evaluate(code, input, table, state, depth + 1); state.scratch = scratch;
    } else if (op === "store") {state.scratch = state.value;}
    else {state.value = operations[op](state.value, state.scratch, value, input, table) >>> 0;}
  }
  throw new Error("RUNTIME_KIRIKIRI_HXV4_VM_INVALID");
}
function boundary(value) {
  const first = Number(value >> 48n), second = Number(value >> 32n & 65535n);
  return {key: Number(value & 255n) || 0xa5, patches: [[first, Number(value >> 8n & 255n)], [second + Number(first === second), Number(value >> 16n & 255n)]]};
}
export function createHxManager(material) {
  const {params, table, nonce0} = material;
  requireFormat(validHxParams(params) && table.length === 1024 && nonce0.length === 24 && params[17] >>> 7 <= 1);
  const lanes = Array.from({length: 128}, (_, i) => lane(params, i));
  const drip = input => {
    const id = input & 127, seed = input >>> 7;
    return BigInt(evaluate(lanes[id], seed, table)) | BigInt(evaluate(lanes[id], ~seed >>> 0, table)) << 32n;
  };
  function state(entryKey, localFlags) {
    let key = entryKey;
    if (!(localFlags & 1)) {key ^= nonce0.readBigUInt64LE();}
    const left = boundary(drip(Number(key & 0xffffffffn))), right = boundary(drip(Number(key >> 32n)));
    const split = params.readUInt16LE(20) + (params.readUInt16LE(18) & Number(key >> 16n & 0xffffffffn));
    const prefix = Buffer.alloc(16); let cursor = u64(~key);
    for (let at = 0; at < 16; at += 8) {cursor = u64(~drip(Number(cursor & 0xffffffffn))); prefix.writeBigUInt64BE(cursor, at);}
    return {left, right, split, prefix};
  }
  return {drip, state};
}
export function applyHxState(bytes, offset, state) {
  requireFormat(Number.isSafeInteger(offset) && offset >= 0);
  const {left, right, split, prefix} = state, end = offset + bytes.length, middle = Math.max(0, Math.min(bytes.length, split - offset));
  for (let i = 0; i < middle; i++) {bytes[i] ^= left.key;}
  for (let i = middle; i < bytes.length; i++) {bytes[i] ^= right.key;}
  for (let i = offset; i < Math.min(16, end); i++) {bytes[i - offset] ^= prefix[i];}
  for (const [side, isLeft] of [[left, true], [right, false]]) {
    for (const [position, value] of side.patches) {
      if (position >= offset && position < end && (position < split) === isLeft) {bytes[position - offset] ^= value;}
    }
  }
  return bytes;
}
