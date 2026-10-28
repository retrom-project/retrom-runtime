// Classic Cx's bounded expression grammar. No extracted machine code is executed.
// Operation numbering/reference: xp3-brute 0.3.7 (MIT), src/cxdec_classic.rs:
// https://docs.rs/crate/xp3-brute/0.3.7/source/src/cxdec_classic.rs
export {discoverCxProfiles, discoverTinyProfiles, extractEmbeddedPeModules} from "./cxdec-pe.mjs";

function uint32(value, code) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(code);
  return value;
}

function permutation(values, count) {
  if (!Array.isArray(values) || values.length !== count || new Set(values).size !== count ||
      values.some(v => !Number.isInteger(v) || v < 0 || v >= count)) throw new Error("CX_PROFILE: invalid operation permutation");
  return [...values];
}

function validateProfile(profile) {
  if (!profile || !(profile.controlBlock instanceof Uint8Array) || profile.controlBlock.length !== 4096) {
    throw new Error("CX_PROFILE: expected exactly 4096 control bytes");
  }
  if (profile.generator !== undefined && profile.generator !== "classic") throw new Error("CX_PROFILE: unsupported generator");
  if (profile.wrappers?.length) throw new Error("CX_PROFILE: unsupported content wrapper");
  const table = Buffer.from(profile.controlBlock);
  return {mask: uint32(profile.mask, "CX_PROFILE: invalid mask"), offset: uint32(profile.offset, "CX_PROFILE: invalid boundary offset"),
    prologOrder: permutation(profile.prologOrder, 3), evenBranchOrder: permutation(profile.evenBranchOrder, 8),
    oddBranchOrder: permutation(profile.oddBranchOrder, 6), words: Array.from({length: 1024}, (_, i) => table.readUInt32LE(i * 4))};
}

function random(state) {
  const old = state.value;
  state.value = (Math.imul(old, 0x41c64e6d) + 0x3039) >>> 0;
  return (state.value ^ (old << 16) ^ (old >>> 16)) >>> 0;
}

// Capacity checks occur in the native emitter's order: consuming RNG before a
// failed reserve would change all subsequent fallback programs for that lane.
class Builder {
  constructor(profile, state) {this.profile = profile; this.state = state; this.length = 9;}
  reserve(length) {
    if (this.length + length > 128) return false;
    this.length += length; return true;
  }
  prolog() {
    switch (this.profile.prologOrder[random(this.state) % 3]) {
      case 0: {
        if (!this.reserve(1)) return null;
        const value = random(this.state);
        return this.reserve(4) ? ["literal", value] : null;
      }
      case 1: return this.reserve(2) ? ["input"] : null;
      case 2: {
        if (!this.reserve(5) || !this.reserve(2)) return null;
        const index = random(this.state) & 1023;
        return this.reserve(4) ? ["table", index] : null;
      }
    }
    return null;
  }
  child(depth) {return random(this.state) & 1 ? this.binary(depth) : this.unary(depth);}
  unary(depth) {
    if (depth === 1) return this.prolog();
    const inner = this.child(depth - 1);
    if (!inner) return null;
    const operation = this.profile.evenBranchOrder[random(this.state) & 7];
    if (operation === 6 || operation === 7) {
      const add = operation === 7 && (random(this.state) & 1) !== 0;
      if (!this.reserve(1)) return null;
      const value = random(this.state);
      return this.reserve(4) ? [operation === 6 ? "xor" : add ? "add" : "sub", inner, value] : null;
    }
    const sizes = [2, 1, 2, 1, 13, 21];
    return this.reserve(sizes[operation]) ? ["unary", operation, inner] : null;
  }
  binary(depth) {
    if (depth === 1) return this.prolog();
    if (!this.reserve(1)) return null;
    const first = this.child(depth - 1);
    if (!first || !this.reserve(2)) return null;
    const second = this.child(depth - 1);
    if (!second) return null;
    const operation = this.profile.oddBranchOrder[random(this.state) % 6];
    if (!this.reserve([9, 9, 2, 4, 3, 2][operation]) || !this.reserve(1)) return null;
    return ["binary", operation, first, second];
  }
}

function program(profile, lane) {
  const state = {value: lane};
  for (let depth = 5; depth >= 1; --depth) {
    const builder = new Builder(profile, state);
    const expression = builder.binary(depth);
    if (expression && builder.reserve(6)) return {expression, depth, byteLength: builder.length};
  }
  throw new Error("CX_PROFILE: expression exceeds generator capacity");
}

function unary(operation, value, words) {
  switch (operation) {
    case 0: return ~value;
    case 1: return value - 1;
    case 2: return -value;
    case 3: return value + 1;
    case 4: return words[value & 1023];
    case 5: return ((value & 0xaaaaaaaa) >>> 1) | ((value & 0x55555555) << 1);
  }
  throw new Error("CX_PROFILE: invalid unary operation");
}

function binary(operation, first, second) {
  switch (operation) {
    case 0: return second >>> (first & 15);
    case 1: return second << (first & 15);
    case 2: return second + first;
    case 3: return first - second;
    case 4: return Math.imul(second, first);
    case 5: return second - first;
  }
  throw new Error("CX_PROFILE: invalid binary operation");
}

function evaluate(expression, input, words) {
  const [operation, a, b, c] = expression;
  switch (operation) {
    case "input": return input;
    case "literal": return a;
    case "table": return words[a];
    case "unary": return unary(a, evaluate(b, input, words), words) >>> 0;
    case "binary": return binary(a, evaluate(b, input, words), evaluate(c, input, words)) >>> 0;
    case "xor": return (evaluate(a, input, words) ^ b) >>> 0;
    case "add": return (evaluate(a, input, words) + b) >>> 0;
    case "sub": return (evaluate(a, input, words) - b) >>> 0;
  }
  throw new Error("CX_PROFILE: invalid expression");
}

function logicalOffset(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > 0xffffffffffffffffn) throw new Error("CX_OFFSET: invalid logical offset");
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("CX_OFFSET: invalid logical offset");
  return BigInt(value);
}

function nonzeroByte(value) {
  if (!Number.isInteger(value) || value < 1 || value > 255) throw new Error("CX_PROFILE: expected nonzero byte fallback");
  return value;
}

/** Tiny folds one resource seed, optionally adding a second XOR at absolute byte zero. */
export function createTinyFilter(sourceProfile) {
  const constant = uint32(sourceProfile?.xorConstant, "CX_PROFILE: invalid Tiny constant");
  const fallback = nonzeroByte(sourceProfile.zeroFallback);
  const firstFallback = sourceProfile.firstByte === undefined ? null : nonzeroByte(sourceProfile.firstByte?.zeroFallback);
  return Object.freeze({apply(bytes, hash, absoluteOffset = 0) {
    if (!(bytes instanceof Uint8Array)) throw new Error("CX_BYTES: expected Uint8Array");
    uint32(hash, "CX_HASH: expected unsigned 32-bit resource hash");
    const offset = logicalOffset(absoluteOffset);
    if (offset + BigInt(bytes.length) > 0x10000000000000000n) throw new Error("CX_OFFSET: stream exceeds uint64");
    const t = (hash ^ constant) >>> 0, key = ((t ^ (t >>> 8) ^ (t >>> 16) ^ (t >>> 24)) & 255) || fallback;
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= key;
    if (firstFallback !== null && offset === 0n && bytes.length) bytes[0] ^= (t & 255) || firstFallback;
    return bytes;
  }});
}

/** apply changes only the supplied bytes, using absolute uncompressed offsets. */
export function createCxFilter(sourceProfile) {
  const profile = validateProfile(sourceProfile);
  const generated = Array.from({length: 128}, (_, lane) => program(profile, lane));
  const evaluateLane = (lane, input) => {
    if (!Number.isInteger(lane) || lane < 0 || lane >= 128) throw new Error("CX_LANE: expected lane 0..127");
    uint32(input, "CX_INPUT: invalid expression input");
    return evaluate(generated[lane].expression, input, profile.words);
  };
  function region(bytes, hash, offset) {
    const lane = hash & 127, seed = hash >>> 7;
    const r1 = evaluateLane(lane, seed), r2 = evaluateLane(lane, (~seed) >>> 0);
    const high = r2 >>> 16;
    let low = r2 & 65535;
    if (high === low) ++low;
    const key = (r1 & 255) || 1;
    for (let i = 0; i < bytes.length; ++i) bytes[i] ^= key;
    const end = offset + BigInt(bytes.length);
    for (const [at, xor] of [[low, (r1 >>> 16) & 255], [high, (r1 >>> 8) & 255]]) {
      const position = BigInt(at);
      if (position >= offset && position < end) bytes[Number(position - offset)] ^= xor;
    }
  }
  return Object.freeze({evaluateLane,
    programs: Object.freeze(generated.map(({depth, byteLength}) => Object.freeze({depth, byteLength}))),
    apply(bytes, hash, absoluteOffset = 0) {
      if (!(bytes instanceof Uint8Array)) throw new Error("CX_BYTES: expected Uint8Array");
      uint32(hash, "CX_HASH: expected unsigned 32-bit resource hash");
      const offset = logicalOffset(absoluteOffset);
      if (offset + BigInt(bytes.length) > 0x10000000000000000n) throw new Error("CX_OFFSET: stream exceeds uint64");
      const boundary = BigInt((((hash & profile.mask) >>> 0) + profile.offset) >>> 0);
      const first = offset < boundary ? Number(boundary - offset < BigInt(bytes.length) ? boundary - offset : BigInt(bytes.length)) : 0;
      if (first) region(bytes.subarray(0, first), hash, offset);
      if (first < bytes.length) region(bytes.subarray(first), (hash ^ (hash >>> 16)) >>> 0, offset + BigInt(first));
      return bytes;
    }});
}
