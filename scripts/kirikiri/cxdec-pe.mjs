import {inflateSync} from "node:zlib";

// Static recognition vocabulary cross-checked with xp3-brute 0.3.7 (MIT):
// https://docs.rs/crate/xp3-brute/0.3.7/source/src/legacy_cxdec.rs
// Pattern candidates require independent resource checksum validation by the importer.

const MAX_MODULE_BYTES = 64 * 1024 * 1024;
const MAX_CANDIDATES = 32;

function bytesOf(input) {
  if (!(input instanceof Uint8Array)) throw new Error("CX_BYTES: expected Uint8Array");
  if (input.length > MAX_MODULE_BYTES) throw new Error("CX_MODULE_LIMIT: module exceeds 64 MiB");
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

function parsePe(bytes) {
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") return null;
  const pe = bytes.readUInt32LE(60);
  if (pe > bytes.length - 24 || bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x14c) return null;
  const count = bytes.readUInt16LE(pe + 6), optional = bytes.readUInt16LE(pe + 20), header = pe + 24;
  if (!count || count > 96 || optional < 64 || header + optional + count * 40 > bytes.length || bytes.readUInt16LE(header) !== 0x10b) return null;
  const imageBase = bytes.readUInt32LE(header + 28), sections = [];
  for (let i = 0; i < count; ++i) {
    const at = header + optional + i * 40;
    const size = bytes.readUInt32LE(at + 16), raw = bytes.readUInt32LE(at + 20), rva = bytes.readUInt32LE(at + 12);
    if (raw + size > bytes.length || rva + size > 0x100000000 || raw < header + optional + count * 40 && size) return null;
    if (sections.some(s => size && s.size && (rva < s.rva + s.size && s.rva < rva + size || raw < s.raw + s.size && s.raw < raw + size))) return null;
    sections.push({raw, size, end: raw + size, rva, executable: (bytes.readUInt32LE(at + 36) & 0x20000000) !== 0});
  }
  const sectionAt = off => sections.find(s => off >= s.raw && off < s.end);
  const toVa = off => {const s = sectionAt(off); return s ? imageBase + s.rva + off - s.raw : null;};
  const fromVa = (va, size = 1, executable) => {
    const s = sections.find(s => va >= imageBase + s.rva && va + size <= imageBase + s.rva + s.size);
    return s && (executable === undefined || s.executable === executable) ? s.raw + va - imageBase - s.rva : null;
  };
  const callTarget = off => {
    if (off < 0 || off + 5 > bytes.length || bytes[off] !== 0xe8) return null;
    const va = toVa(off);
    return va === null ? null : fromVa(va + 5 + bytes.readInt32LE(off + 1), 1, true);
  };
  return {sections, imageBase, toVa, fromVa, callTarget, sectionAt};
}

/** Returns independent PE buffers; cumulative attempted expansion is capped before each inflate. */
export function extractEmbeddedPeModules(input, options = {}) {
  const bytes = bytesOf(input), marker = Buffer.from("internal module\0"), modules = [];
  const requestedBudget = options?.maxTotalBytes ?? MAX_MODULE_BYTES;
  if (!Number.isSafeInteger(requestedBudget) || requestedBudget < 0) throw new Error("CX_MODULE_LIMIT: invalid embedded expansion budget");
  let remainingBytes = Math.min(requestedBudget, MAX_MODULE_BYTES);
  let cursor = 0, records = 0;
  while (cursor < bytes.length) {
    const at = bytes.indexOf(marker, cursor);
    if (at < 0) break;
    if (++records > MAX_CANDIDATES) throw new Error("CX_MODULE_LIMIT: too many embedded module records");
    const start = at + marker.length, end = Math.min(bytes.length - 2, start + 256);
    for (let z = start + 8; z < end; ++z) {
      if ((bytes[z] & 15) !== 8 || bytes[z] >>> 4 > 7 || ((bytes[z] << 8) + bytes[z + 1]) % 31) continue;
      const expanded = bytes.readUInt32LE(z - 8), packed = bytes.readUInt32LE(z - 4);
      if (!expanded || expanded > MAX_MODULE_BYTES || packed < 2 || packed > MAX_MODULE_BYTES || z + packed > bytes.length) continue;
      // Reserve declared bytes before any zlib allocation, including attempts
      // that later fail PE/stream validation. Keep this outside the candidate
      // catch: exceeding the budget must not become a silently skipped record.
      if (expanded > remainingBytes) throw new Error("CX_MODULE_LIMIT: cumulative embedded expansion exceeds budget");
      remainingBytes -= expanded;
      try {
        const inflated = inflateSync(bytes.subarray(z, z + packed), {maxOutputLength: expanded, info: true});
        if (inflated.buffer.length === expanded && inflated.engine.bytesWritten === packed && parsePe(inflated.buffer)) {
          modules.push(inflated.buffer); break;
        }
      } catch { /* A candidate zlib header is not an authenticated module record. */ }
    }
    cursor = at + marker.length;
  }
  return modules;
}

const u32 = (b, at) => b.readUInt32LE(at);
function hasU32(bytes, value) {const b = Buffer.alloc(4); b.writeUInt32LE(value); return bytes.includes(b);}
function unique(values, key) {return [...new Map(values.map(v => [key(v), v])).values()];}
function cap(values) {
  if (values.length > MAX_CANDIDATES) throw new Error("CX_AMBIGUOUS: too many static profile candidates");
  return values;
}

function storesRegister(bytes, start, end, reg, displacement) {
  const found = [];
  for (let i = start; i + 2 < end; ++i) {
    const m = bytes[i + 1];
    if (bytes[i] === 0x89 && (m >> 6) === 1 && ((m >> 3) & 7) === reg && (m & 7) !== 4 && bytes[i + 2] === displacement) found.push(m & 7);
  }
  return found;
}

function boundaries(bytes, pe) {
  const out = [];
  for (const s of pe.sections.filter(s => s.executable)) {
    for (let i = s.raw; i + 12 < s.end; ++i) {
      if (bytes[i] !== 0x81 || (bytes[i + 1] & 0xf8) !== 0xe0) continue;
      const reg = bytes[i + 1] & 7, mask = u32(bytes, i + 2);
      if (!mask || mask > 0xffffff) continue;
      const before = storesRegister(bytes, Math.max(s.raw, i - 16), i, reg, 4);
      if (!before.length) continue;
      for (let a = i + 6; a + 6 <= Math.min(i + 30, s.end); ++a) {
        if (bytes[a] !== 0x81 || bytes[a + 1] !== (0xc0 | reg)) continue;
        const offset = u32(bytes, a + 2);
        if (!offset || offset > 0xffffff) continue;
        const after = storesRegister(bytes, a + 6, Math.min(s.end, a + 24), reg, 8);
        if (after.some(base => before.includes(base))) out.push({mask, offset, at: i});
      }
    }
  }
  return cap(unique(out, p => `${p.mask}:${p.offset}`));
}

function indirectCall(bytes, at) {return bytes[at] === 0xff && ((bytes[at + 1] >> 3) & 7) === 2;}
function seedCalls(bytes, start, end, seed) {
  const push = 0x50 + seed;
  for (let a = start; a + 2 < end; ++a) {
    if (bytes[a] !== push) continue;
    let first = false;
    for (let p = a + 1; p + 1 < Math.min(end, a + 9); ++p) if (indirectCall(bytes, p)) first = true;
    if (!first) continue;
    for (let n = a + 1; n + 2 < end; ++n) {
      if (bytes[n] !== 0xf7 || bytes[n + 1] !== 0xd0 + seed) continue;
      for (let p = n + 2; p < Math.min(end, n + 14); ++p) {
        if (bytes[p] !== push) continue;
        for (let c = p + 1; c + 1 < Math.min(end, p + 9); ++c) if (indirectCall(bytes, c)) return true;
      }
    }
  }
  return false;
}

// Follow only explicit register -> frame slot -> register copies. This reads a
// compiler's static def/use relationship; it does not evaluate x86 or its stack.
function spilledSeeds(bytes, shift, end) {
  const source = bytes[shift + 1] & 7, seeds = [source];
  for (let store = shift + 3; store + 2 < Math.min(end, shift + 12); ++store) {
    const m = bytes[store + 1];
    if (bytes[store] !== 0x89 || m >> 6 !== 1 || (m >> 3 & 7) !== source || (m & 7) === 4) continue;
    for (let load = store + 3; load + 2 < end; ++load) {
      const n = bytes[load + 1];
      if (bytes[load] === 0x8b && n >> 6 === 1 && (n & 7) === (m & 7) && bytes[load + 2] === bytes[store + 2]) seeds.push(n >> 3 & 7);
    }
  }
  return seeds;
}

function managers(bytes, pe) {
  const out = [];
  for (const s of pe.sections.filter(s => s.executable)) {
    const code = bytes.subarray(s.raw, s.end);
    if (!hasU32(code, 0x41c64e6d) || !hasU32(code, 0x3039)) continue;
    for (let a = s.raw; a + 3 < s.end; ++a) {
      if (bytes[a] !== 0x83 || (bytes[a + 1] & 0xf8) !== 0xe0 || bytes[a + 2] !== 127) continue;
      const lane = bytes[a + 1] & 7;
      const seeds = new Set();
      for (let p = Math.max(s.raw, a - 32); p + 2 < Math.min(s.end, a + 32); ++p) {
        if (bytes[p] === 0xc1 && (bytes[p + 1] & 0xf8) === 0xe8 && bytes[p + 2] === 7) {
          for (const seed of spilledSeeds(bytes, p, Math.min(s.end, a + 0x180))) seeds.add(seed);
        }
      }
      if (!seeds.size) continue;
      const start = Math.max(s.raw, a - 48), end = Math.min(s.end, a + 0x180);
      for (let p = start; p + 5 < end; ++p) {
        if (bytes[p] !== 0x68 || u32(bytes, p + 1) !== 128) continue;
        for (let c = p + 5; c + 5 < Math.min(end, p + 28); ++c) {
          const builder = pe.callTarget(c);
          if (builder === null || !bytes.subarray(p + 5, c).includes(0x50 + lane)) continue;
          if (![...seeds].some(seed => seedCalls(bytes, c + 5, end, seed))) continue;
          for (let g = Math.max(start, p - 48); g + 5 <= p; ++g) {
            const getter = pe.callTarget(g);
            if (getter === null || getter + 6 > bytes.length || bytes[getter] !== 0xb8 || bytes[getter + 5] !== 0xc3) continue;
            const table = pe.fromVa(u32(bytes, getter + 1), 4096, false);
            if (table !== null) out.push({at: a, builder, table, getter});
          }
        }
      }
    }
  }
  return cap(unique(out, m => `${m.builder}:${m.table}`));
}

// Recognize the emitted grammar, not instructions to be run. Emission helpers
// receive opcodes as PUSH immediates; inline emitters use MOV byte [reg], imm8.
function emittedValues(bytes) {
  const values = [];
  for (let i = 0; i < bytes.length; ++i) {
    if (bytes[i] === 0x68 && i + 4 < bytes.length) {values.push(u32(bytes, i + 1)); i += 4;}
    else if (bytes[i] === 0x6a && i + 1 < bytes.length) values.push(bytes[++i]);
    else if (bytes[i] === 0xc6 && i + 2 < bytes.length && (bytes[i + 1] & 0xf8) === 0) values.push(bytes[i + 2]);
  }
  return values;
}

function classify(bytes, kind) {
  const values = emittedValues(bytes), has = v => values.includes(v), raw = v => hasU32(bytes, v);
  if (kind === 3) {
    if (has(0xbe) && (has(0x86) || raw(1023))) return 2;
    if (has(0x8b) && has(0xc7)) return 1;
    if (has(0xb8)) return 0;
  } else if (kind === 8) {
    if (raw(0xaaaaaaaa) && raw(0x55555555) || values.filter(v => v === 170).length >= 4 && values.filter(v => v === 85).length >= 4) return 5;
    if (raw(1023) && (has(0xbe) || has(0x86) || has(0x25))) return 4;
    if (has(0x35)) return 6;
    if (has(5) || has(0x2d)) return 7;
    if (has(0xf7) && has(0xd0)) return 0;
    if (has(0xf7) && has(0xd8)) return 2;
    if (has(0x48)) return 1;
    if (has(0x40)) return 3;
  } else {
    if (has(0x0f) && has(0xaf) && has(0xc3)) return 4;
    if (has(0xf7) && has(0xd8) && has(1)) return 3;
    if (has(0x29) && has(0xd8)) return 5;
    if (has(1) && has(0xd8)) return 2;
    if (has(0xd3) && has(0xe8)) return 0;
    if (has(0xd3) && has(0xe0)) return 1;
  }
  return null;
}

function branch(bytes, at, end) {
  const op = bytes[at];
  if ((op === 0xeb || op >= 0x70 && op <= 0x7f) && at + 2 <= end) return {length: 2, target: at + 2 + bytes.readInt8(at + 1), op};
  if (op === 0xe9 && at + 5 <= end) return {length: 5, target: at + 5 + bytes.readInt32LE(at + 1), op};
  if (op === 0x0f && at + 6 <= end && bytes[at + 1] >= 0x80 && bytes[at + 1] <= 0x8f) {
    return {length: 6, target: at + 6 + bytes.readInt32LE(at + 2), op: bytes[at + 1] - 0x10};
  }
  return null;
}

function semantic(bytes, pe, target, primaryEnd, kind) {
  const s = pe.sectionAt(target);
  if (!s?.executable) return null;
  const end = Math.min(s.end, primaryEnd, target + 160);
  let block = bytes.subarray(target, end), result = classify(block, kind), followed = 0;
  if (result !== null) return result;
  for (let at = target; at < end && followed < 8; ++at) {
    const jump = branch(bytes, at, end);
    // Conditional failure paths may contain a sibling emission case. Only
    // unconditional shared success tails contribute to this case's grammar.
    if (!jump || ![0xeb, 0xe9].includes(jump.op) || Math.abs(jump.target - target) > 0x4000 || jump.target >= target && jump.target < end) continue;
    const section = pe.sectionAt(jump.target);
    if (!section?.executable) continue;
    block = Buffer.concat([block, bytes.subarray(jump.target, Math.min(section.end, jump.target + 24))]);
    result = classify(block, kind); ++followed;
    if (result !== null) return result;
    at += jump.length - 1;
  }
  return null;
}

function orderAt(bytes, pe, targets, kind) {
  const values = targets.map(target => semantic(bytes, pe, target, Math.min(...targets.filter(t => t > target), target + 160), kind));
  return values.every(v => v !== null) && new Set(values).size === kind ? values : null;
}

function branchPrologs(bytes, pe, s) {
  const out = [];
  for (let at = s.raw; at + 32 < s.end; ++at) {
    if (bytes[at] < 0xb8 || bytes[at] > 0xbf || u32(bytes, at + 1) !== 3) continue;
    let division = null;
    for (let d = at + 5; d + 1 < Math.min(s.end, at + 64); ++d) {
      if (bytes[d] === 0xf7 && bytes[d + 1] === (0xf0 | bytes[at] - 0xb8)) {division = d; break;}
    }
    if (division === null) continue;
    const eq = [], end = Math.min(s.end, division + 80);
    for (let p = division + 2; p < end && eq.length < 2; ++p) {
      const jump = branch(bytes, p, end);
      if (jump?.op === 0x74) {eq.push({at: p, ...jump}); p += jump.length - 1;}
    }
    if (eq.length !== 2) continue;
    let third = null;
    for (let p = eq[1].at + eq[1].length; p < Math.min(end, eq[1].at + 25); ++p) {
      const jump = branch(bytes, p, end);
      if (jump?.op === 0x75) {third = p + jump.length; break;}
    }
    if (third === null) continue;
    const order = orderAt(bytes, pe, [eq[0].target, eq[1].target, third], 3);
    if (order) out.push({at, kind: 3, order});
  }
  return out;
}

function dispatches(bytes, pe) {
  const out = [];
  for (const s of pe.sections.filter(s => s.executable)) {
    out.push(...branchPrologs(bytes, pe, s));
    for (let at = s.raw; at + 7 < s.end; ++at) {
      const sib = bytes[at + 2];
      if (bytes[at] !== 0xff || bytes[at + 1] !== 0x24 || sib >> 6 !== 2 || (sib & 7) !== 5 || (sib >> 3 & 7) === 4) continue;
      for (const kind of [3, 8, 6]) {
        const table = pe.fromVa(u32(bytes, at + 3), kind * 4);
        if (table === null) continue;
        const targets = Array.from({length: kind}, (_, i) => pe.fromVa(u32(bytes, table + i * 4), 1, true));
        if (targets.some(t => t === null)) continue;
        const order = orderAt(bytes, pe, targets, kind);
        if (order) out.push({at, kind, order});
      }
    }
  }
  return cap(unique(out, d => `${d.kind}:${d.order}`));
}

/** Candidates require code-linked manager, file-backed table, constructor and complete grammar permutations. */
export function discoverCxProfiles(input) {
  const bytes = bytesOf(input), pe = parsePe(bytes);
  if (!pe) return [];
  const manager = managers(bytes, pe);
  if (!manager.length) return [];
  const splits = boundaries(bytes, pe), switches = dispatches(bytes, pe), profiles = [];
  for (const m of manager) {
    const nearby = switches.filter(d => Math.abs(pe.toVa(d.at) - pe.toVa(m.builder)) <= 0x20000);
    for (const p of nearby.filter(d => d.kind === 3)) for (const e of nearby.filter(d => d.kind === 8)) for (const o of nearby.filter(d => d.kind === 6)) {
      for (const split of splits) {
        profiles.push({mask: split.mask, offset: split.offset, prologOrder: p.order, evenBranchOrder: e.order, oddBranchOrder: o.order,
          controlBlock: Buffer.from(bytes.subarray(m.table, m.table + 4096)), generator: "classic",
          evidence: {managerVa: pe.toVa(m.at), builderVa: pe.toVa(m.builder), tableVa: pe.toVa(m.table), boundaryVa: pe.toVa(split.at),
            dispatchVa: [pe.toVa(p.at), pe.toVa(e.at), pe.toVa(o.at)]}});
        cap(profiles);
      }
    }
  }
  return unique(profiles, p => `${p.mask}:${p.offset}:${p.prologOrder}:${p.evenBranchOrder}:${p.oddBranchOrder}:${p.controlBlock.toString("hex")}`);
}

function registerMove(bytes, at) {
  const opcode = bytes[at], m = bytes[at + 1];
  if (![0x89, 0x8b].includes(opcode) || m >> 6 !== 3) return null;
  return opcode === 0x8b ? {to: m >> 3 & 7, from: m & 7} : {to: m & 7, from: m >> 3 & 7};
}

function shiftIs(bytes, at, reg, amount) {return bytes[at] === 0xc1 && bytes[at + 1] === (0xe8 | reg) && bytes[at + 2] === amount;}
function xorIs(bytes, at, to, from) {
  return bytes[at] === 0x32 && bytes[at + 1] === (0xc0 | to << 3 | from) ||
    bytes[at] === 0x30 && bytes[at + 1] === (0xc0 | from << 3 | to);
}

function tinyFold(bytes, at, source, end) {
  if (at + 31 > end || source > 3) return null;
  const high = registerMove(bytes, at), middle = registerMove(bytes, at + 5);
  const interleaved = registerMove(bytes, at + 10), low = interleaved ?? registerMove(bytes, at + 12);
  if (!high || !middle || !low || high.from !== source || middle.from !== source || low.from !== source ||
      high.to === source || high.to > 3 || middle.to === source || middle.to === high.to || middle.to > 3 ||
      low.to === source || low.to === high.to || low.to > 3 || interleaved && low.to === middle.to) return null;
  if (!shiftIs(bytes, at + 2, high.to, 24) || !shiftIs(bytes, at + 7, middle.to, 16) ||
      !xorIs(bytes, at + (interleaved ? 12 : 10), high.to, middle.to) || !shiftIs(bytes, at + 14, low.to, 8) ||
      !xorIs(bytes, at + 17, high.to, low.to) || !xorIs(bytes, at + 19, high.to, source)) return null;
  const p = at + 21, base = bytes[p + 1] & 7;
  if (base === 4 || [source, high.to, middle.to, low.to].includes(base) || bytes[p] !== 0x88 ||
      bytes[p + 1] !== (0x40 | high.to << 3 | base) || bytes[p + 2] !== 4) return null;
  const jump = branch(bytes, p + 3, end);
  if (jump?.op !== 0x75) return null;
  const z = p + 3 + jump.length;
  if (z + 4 > end || bytes[z] !== 0xc6 || bytes[z + 1] !== (0x40 | base) || bytes[z + 2] !== 4 || !bytes[z + 3] || jump.target !== z + 4) return null;
  return {zeroFallback: bytes[z + 3], zeroAt: z, end: z + 4, base};
}

// Only the supported IStream consumer shape: a 64-bit absolute-zero test plus
// a nonempty read guards field 5; field 4 then drives the ordinary bulk XOR.
function tinyConsumer(bytes, pe, xorAt, base) {
  const prefix = Buffer.from([0x8b, 0x44, 0x24, 12, 0x8b, 0x54, 0x24, 16, 0x56, 0x57,
    0x8b, 0x7c, 0x24, 12, 0x0b, 0x7c, 0x24, 16, 0x8d, 0x34, 0x10,
    0x75, 9, 0x85, 0xd2, 0x76, 5, 0x8a, 0x51, 5, 0x30, 0x10, 0x8a, 0x51, 4]);
  const section = pe.sectionAt(xorAt), consumers = [];
  for (let at = Math.max(section.raw, xorAt - 24); at + 6 <= xorAt; at++) {
    if (base === 5 || bytes[at] !== 0xc7 || bytes[at + 1] !== base) continue;
    const table = pe.fromVa(u32(bytes, at + 2), 8, false);
    if (table === null) continue;
    const consumer = pe.fromVa(u32(bytes, table + 4), prefix.length, true);
    if (consumer === null || !bytes.subarray(consumer, consumer + prefix.length).equals(prefix)) continue;
    const tail = bytes.subarray(consumer + prefix.length, Math.min(pe.sectionAt(consumer).end, consumer + 128));
    if (tail.includes(Buffer.from([0x30, 0x10]))) consumers.push(consumer);
  }
  return consumers.length === 1 ? consumers[0] : null;
}

function tinyFirstByte(bytes, pe, xorAt, source, fold, end) {
  let at = fold.end;
  if (bytes[at] !== 0x88) return {};
  const base = fold.base;
  if (bytes[at + 1] !== (0x40 | source << 3 | base) || bytes[at + 2] !== 5) return null;
  at += 3;
  const result = registerMove(bytes, at);
  if (result?.to === 0 && result.from === base) at += 2;
  if (bytes[at] !== 0x84 || bytes[at + 1] !== (0xc0 | source << 3 | source)) return null;
  const jump = branch(bytes, at + 2, end), zeroAt = at + 4;
  if (jump?.op !== 0x75 || jump.length !== 2 || jump.target !== zeroAt + 4 || zeroAt + 4 > end ||
      bytes[zeroAt] !== 0xc6 || bytes[zeroAt + 1] !== (0x40 | base) || bytes[zeroAt + 2] !== 5 || !bytes[zeroAt + 3]) return null;
  const consumer = tinyConsumer(bytes, pe, xorAt, base);
  if (consumer === null) return null;
  return {firstByte: {zeroFallback: bytes[zeroAt + 3]}, evidence: {firstZeroFallbackVa: pe.toVa(zeroAt), consumerVa: pe.toVa(consumer)}};
}

/** Tiny folding constructors use one connected SHR/XOR register chain and a guarded zero replacement. */
export function discoverTinyProfiles(input) {
  const bytes = bytesOf(input), pe = parsePe(bytes), profiles = [];
  if (!pe) return [];
  for (const s of pe.sections.filter(s => s.executable)) {
    for (let at = s.raw; at + 12 < s.end; ++at) {
      let source, length, xorConstant;
      if (bytes[at] === 0x81 && (bytes[at + 1] & 0xf8) === 0xf0) {source = bytes[at + 1] & 7; length = 6; xorConstant = u32(bytes, at + 2);}
      else if (bytes[at] === 0x35) {source = 0; length = 5; xorConstant = u32(bytes, at + 1);}
      else continue;
      const fold = tinyFold(bytes, at + length, source, s.end);
      if (!fold) continue;
      const first = tinyFirstByte(bytes, pe, at, source, fold, s.end);
      if (first) profiles.push({xorConstant, zeroFallback: fold.zeroFallback, ...(first.firstByte ? {firstByte: first.firstByte} : {}),
        evidence: {xorVa: pe.toVa(at), zeroFallbackVa: pe.toVa(fold.zeroAt), ...first.evidence}});
    }
  }
  return cap(unique(profiles, p => `${p.xorConstant}:${p.zeroFallback}:${p.firstByte?.zeroFallback ?? "none"}`));
}
