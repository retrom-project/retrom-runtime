// @vitest-environment node
import {createHash} from "node:crypto";
import {deflateSync, inflateSync} from "node:zlib";
import {describe, expect, it, vi} from "vitest";
import {createCxFilter, discoverCxProfiles, discoverTinyProfiles, extractEmbeddedPeModules} from "../scripts/kirikiri/cxdec.mjs";
import {tinyPE, tinyFirstBytePE} from "./kirikiri-pe-fixture.js";

vi.mock("node:zlib", async () => {
  const actual = await vi.importActual<typeof import("node:zlib")>("node:zlib");
  return {...actual, inflateSync: vi.fn(actual.inflateSync)};
});

function controlBlock() {
  const b = Buffer.alloc(4096);
  for (let i = 0; i < 1024; ++i) b.writeUInt32LE((Math.imul(i, 0x9e3779b1) ^ 0xa5a5a5a5) >>> 0, i * 4);
  return b;
}
const profile = () => ({mask: 0x2c5, offset: 0x357, prologOrder: [1, 2, 0],
  evenBranchOrder: [4, 7, 2, 6, 1, 5, 0, 3], oddBranchOrder: [4, 5, 0, 3, 1, 2], controlBlock: controlBlock()});
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// Entirely synthetic PE32 and x86 byte-emission patterns, never executable inputs.
function fixture(branchProlog = false, callback = false) {
  const b = Buffer.alloc(0x6000, 0);
  b.write("MZ"); b.writeUInt32LE(0x80, 0x3c); b.write("PE\0\0", 0x80, "binary");
  b.writeUInt16LE(0x14c, 0x84); b.writeUInt16LE(2, 0x86); b.writeUInt16LE(0xe0, 0x94);
  b.writeUInt16LE(0x10b, 0x98); b.writeUInt32LE(0x10000000, 0xb4); b.writeUInt32LE(0x8000, 0xd0);
  const section = (at: number, name: string, rva: number, size: number, raw: number, flags: number) => {
    b.write(name, at); b.writeUInt32LE(size, at + 8); b.writeUInt32LE(rva, at + 12);
    b.writeUInt32LE(size, at + 16); b.writeUInt32LE(raw, at + 20); b.writeUInt32LE(flags, at + 36);
  };
  section(0x178, ".text", 0x1000, 0x2000, 0x400, 0x60000020);
  section(0x1a0, ".rdata", 0x4000, 0x3000, 0x2400, 0x40000040);
  const va = (off: number) => 0x10000000 + (off < 0x2400 ? off + 0xc00 : off + 0x1c00);
  const imm = (value: number) => {const q = Buffer.alloc(4); q.writeUInt32LE(value >>> 0); return [...q];};
  const put = (at: number, bytes: number[]) => Buffer.from(bytes).copy(b, at);
  const call = (at: number, target: number) => {b[at] = 0xe8; b.writeInt32LE(va(target) - va(at) - 5, at + 1);};
  // Same-register constructor store h -> mask/add -> store boundary.
  put(0x440, [0x89, 0x48, 4, 0x81, 0xe1, ...imm(0x2c5), 0x81, 0xc1, ...imm(0x357), 0x89, 0x48, 8, 0xc3]);
  // Bounded dynamic manager: lane split, table getter, 128-byte builder and seed/complement call pair.
  put(0x480, [0x83, 0xe3, 0x7f, 0xc1, 0xed, 7]); call(0x488, 0x520);
  put(0x490, [0x68, 0x80, 0, 0, 0, 0x53]); call(0x496, 0x540);
  put(0x49b, [0x55, 0xff, 0xd6, 0xf7, 0xd5, 0x55, 0xff, 0xd6, 0xc3]);
  put(0x520, [0xb8, ...imm(va(0x3000)), 0xc3]);
  put(0x540, [0x69, 0xc0, ...imm(0x41c64e6d), 0x05, ...imm(0x3039), 0xc3]);
  controlBlock().copy(b, 0x3000);
  const emit = (values: number[]) => values.flatMap(v => [0x68, ...imm(v)]);
  const prologs = [[0xb8], [0x8b, 0xc7], [0xbe, 0x86, 0x3ff]];
  const evens = [[0xf7, 0xd0], [0x48], [0xf7, 0xd8], [0x40], [0xbe, 0x25, 0x3ff, 0x86],
    [0xaaaaaaaa, 0x55555555], [0x35], [0x05, 0x2d]];
  const odds = [[0xd3, 0xe8], [0xd3, 0xe0], [1, 0xd8], [0xf7, 0xd8, 1], [0x0f, 0xaf, 0xc3], [0x29, 0xd8]];
  const dispatch = (at: number, table: number, blocks: number, order: number[], patterns: number[][]) => {
    put(at, [0xff, 0x24, 0x85, ...imm(va(table))]);
    for (let i = 0; i < order.length; ++i) {
      b.writeUInt32LE(va(blocks + i * 0x60), table + i * 4);
      put(blocks + i * 0x60, [...emit(patterns[order[i]]), 0xc3]);
    }
  };
  if (branchProlog) {
    // Optimized manager spills its shifted key and reloads it into another register.
    put(0x480, [0xc1, 0xe8, 7, 0x89, 0x45, 8, 0x83, 0xe3, 0x7f]); call(0x48a, 0x520);
    put(0x49b, [0x8b, 0x5d, 8, 0x53, 0xff, 0xd6, 0xf7, 0xd3, 0x53, 0xff, 0xd6, 0xc3]);
    // div ECX -> test EDX -> JE remainder 0 -> DEC EDX -> JE remainder 1 -> DEC/JNE guard.
    put(0x570, [0xb9, 3, 0, 0, 0]);
    put(0x585, [0xf7, 0xf1, 0x85, 0xd2, 0x0f, 0x84]);
    b.writeInt32LE(0x650 - 0x58f, 0x58b);
    put(0x58f, [0x4a, 0x0f, 0x84]); b.writeInt32LE(0x6b0 - 0x596, 0x592);
    put(0x596, [0x4a, 0x75, 0x50, ...emit(prologs[0]), 0xc3]);
    put(0x650, [...emit(prologs[1]), 0xc3]); put(0x6b0, [...emit(prologs[2]), 0xc3]);
  } else dispatch(0x580, 0x2500, 0x650, profile().prologOrder, prologs);
  dispatch(0x800, 0x2520, 0x900, profile().evenBranchOrder, evens);
  dispatch(0xd00, 0x2550, 0xe00, profile().oddBranchOrder, odds);
  if (callback) {
    b.fill(0, 0x440, 0x4c0);
    // Extraction callback ABI (24 bytes), seed field 20, boundary and the
    // same region consumer before/after seed ^ (seed >>> 16).
    put(0x440, [0x83, 0x3e, 24, 0x8b, 0x76, 20, 0x8b, 0xc6, 0x25, ...imm(profile().mask), 0x05, ...imm(profile().offset)]);
    call(0x458, 0x4d0);
    put(0x45d, [0x8b, 0xc6, 0xc1, 0xe8, 16, 0x33, 0xc6]); call(0x464, 0x4d0);
    put(0x480, [0x83, 0xe3, 127, 0xc1, 0xef, 7, 0x8b, 0xc3]); call(0x488, 0x540);
    put(0x490, [0x57, 0xff, 0xd6, 0xf7, 0xd7, 0x57, 0xff, 0xd6, 0xc3]);
    // Legacy emitters pass opcode arguments in registers. The control table
    // is a direct immediate in the table-load prolog rather than a getter.
    put(0x6b0, [0xb2, 0xbe, 0xb9, ...imm(va(0x3000)), 0xb2, 0x86, 0x68, ...imm(1023), 0xc3]);
  }
  return b;
}

describe("classic Cx expression interpreter", () => {
  it("matches independent synthetic Rust reference for all 128 lanes and fallback PRNG state", () => {
    const f = createCxFilter(profile());
    const results = Buffer.alloc(128 * 4);
    for (let lane = 0; lane < 128; ++lane) results.writeUInt32LE(f.evaluateLane(lane, 0x12345678), lane * 4);
    // Generated with the independent parameterized Rust evaluator using only the synthetic profile/table above.
    expect(sha(results)).toBe("05f86b94df751f6cf4f240e24c9fc878044f40e26088c6ac4deb1de3799c3a36");
    expect(f.programs).toHaveLength(128);
    expect(f.programs.some((p: {depth: number}) => p.depth < 5)).toBe(true);
    expect(f.programs.every((p: {byteLength: number}) => p.byteLength <= 128)).toBe(true);
  });
  it("matches an independent full stream including boundary split and both sparse patches", () => {
    const f = createCxFilter(profile());
    const bytes = Buffer.from(Array.from({length: 70000}, (_, i) => (i * 13 + 7) & 255));
    const original = Buffer.from(bytes);
    expect(f.apply(bytes, 0x8a4b192e, 0)).toBe(bytes);
    expect(sha(bytes)).toBe("183a0f473233ea569e94386e7c6711d9254b29d7392ef0ccaf1cf7ff5f6840a9");
    f.apply(bytes, 0x8a4b192e, 0);
    expect(bytes).toEqual(original);
  });
  it("keeps absolute logical offsets through arbitrary chunks, partial reads and >4GiB offsets", () => {
    const f = createCxFilter(profile());
    const whole = Buffer.alloc(70000, 0x9d); f.apply(whole, 0x8a4b192e);
    const pieces = Buffer.alloc(whole.length, 0x9d);
    const boundary = (0x8a4b192e & profile().mask) + profile().offset;
    const cuts = [0, 13, boundary - 1, boundary, boundary + 1, 21907, 65536, pieces.length];
    for (let i = 1; i < cuts.length; ++i) f.apply(pieces.subarray(cuts[i - 1], cuts[i]), 0x8a4b192e, cuts[i - 1]);
    expect(pieces).toEqual(whole);
    const slice = Buffer.alloc(89, 0x9d); f.apply(slice, 0x8a4b192e, 21789n);
    expect(slice).toEqual(whole.subarray(21789, 21878));
    const far = Buffer.alloc(31, 5); f.apply(far, 0x8a4b192e, 0x1_0000_0000n);
    const later = Buffer.alloc(31, 5); f.apply(later, 0x8a4b192e, 0x2_0000_0000n);
    expect(far).toEqual(later);
  });
  it("rejects incomplete/permuted-invalid profiles and invalid offset/hash without mutating input", () => {
    expect(() => createCxFilter({...profile(), prologOrder: [1, 1, 2]})).toThrow(/CX_PROFILE/u);
    expect(() => createCxFilter({...profile(), controlBlock: Buffer.alloc(8)})).toThrow(/CX_PROFILE/u);
    const f = createCxFilter(profile()); const b = Buffer.alloc(5, 7);
    for (const offset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => f.apply(b, 0, offset)).toThrow(/CX_OFFSET/u);
    expect(() => f.apply(b, 0x1_0000_0000, 0)).toThrow(/CX_HASH/u);
    expect(b).toEqual(Buffer.alloc(5, 7));
    const p = profile(); const a = createCxFilter(p); p.controlBlock.fill(0); p.prologOrder.reverse();
    expect(a.evaluateLane(0, 123)).toBe(createCxFilter(profile()).evaluateLane(0, 123));
  });
});

describe("bounded static PE recovery", () => {
  it("recovers the legacy extraction-callback boundary and direct-table generator without stored game profiles", () => {
    const b = fixture(true, true);
    const found = discoverCxProfiles(b);
    expect(found).toHaveLength(1); expect(found[0]).toMatchObject(profile());
    const missingFold = Buffer.from(b); missingFold[0x460] = 15;
    expect(discoverCxProfiles(missingFold)).toEqual([]);
    const wrongABI = Buffer.from(b); wrongABI[0x442] = 20;
    expect(discoverCxProfiles(wrongABI)).toEqual([]);
    const unrelatedBuilder = Buffer.from(b); unrelatedBuilder[0x487] = 0xc2;
    expect(discoverCxProfiles(unrelatedBuilder)).toEqual([]);
  });
  it("recovers a dual-key Tiny constructor and its first-byte consumer through the vtable", () => {
    expect(discoverTinyProfiles(tinyFirstBytePE())).toMatchObject([
      {xorConstant: 0x12345678, zeroFallback: 0x55, firstByte: {zeroFallback: 0x69}}
    ]);
  });
  it("recovers Tiny constants only from one connected four-byte fold and its zero-key guard", () => {
    const b = tinyPE();
    expect(discoverTinyProfiles(b)).toMatchObject([{xorConstant: 0x12345678, zeroFallback: 0x55}]);
    const unrelated = Buffer.from(b); unrelated[0x150c] = 0xc2; // second shifted word now comes from an unrelated register
    expect(discoverTinyProfiles(unrelated)).toEqual([]);
    const missingGuard = Buffer.from(b); missingGuard[0x151e] = 0x74;
    expect(discoverTinyProfiles(missingGuard)).toEqual([]);
    const differentObject = Buffer.from(b); differentObject[0x1521] = 0x47;
    expect(discoverTinyProfiles(differentObject)).toEqual([]);
    b.fill(0, 0x1500, 0x1560);
    // The accumulator-specific XOR encoding and different source/temporary/object registers are equivalent.
    Buffer.from([0x35, 0x21, 0x43, 0x65, 0x87, 0x8b, 0xd0, 0xc1, 0xea, 24,
      0x8b, 0xc8, 0xc1, 0xe9, 16, 0x32, 0xd1, 0x8b, 0xc8, 0xc1, 0xe9, 8,
      0x32, 0xd1, 0x32, 0xd0, 0x88, 0x57, 4, 0x75, 4, 0xc6, 0x47, 4, 0x69, 0xc3]).copy(b, 0x1500);
    expect(discoverTinyProfiles(b)).toMatchObject([{xorConstant: 0x87654321, zeroFallback: 0x69}]);
  });
  it.each([false, true])("recovers complete format parameters without a title/control marker, branch prolog=%s", branch => {
    const input = fixture(branch); const before = Buffer.from(input); const found = discoverCxProfiles(input);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject(profile()); expect(input).toEqual(before);
  });
  it("rejects decoy constants, missing relationships, ambiguous/truncated PE mappings and invalid dispatch permutations", () => {
    const noManager = fixture(); noManager.fill(0, 0x480, 0x4a8);
    expect(discoverCxProfiles(noManager)).toEqual([]);
    const badDispatch = fixture(); badDispatch.writeUInt32LE(badDispatch.readUInt32LE(0x2520), 0x2524);
    expect(discoverCxProfiles(badDispatch)).toEqual([]);
    expect(discoverCxProfiles(fixture().subarray(0, 0x200))).toEqual([]);
    const overlap = fixture(); overlap.writeUInt32LE(0x1000, 0x1a0 + 12);
    expect(discoverCxProfiles(overlap)).toEqual([]);
  });
  it("follows shared successful emission tails without confusing an error branch with a sibling case", () => {
    const b = fixture();
    const put = (at: number, values: number[]) => Buffer.from(values).copy(b, at);
    // NEG followed by ADD lives in a shared tail; the conditional failure path happens to contain SUB.
    b.fill(0, 0xf20, 0xf80);
    put(0xf20, [0x68, 0xf7, 0, 0, 0, 0x68, 0xd8, 0, 0, 0, 0x0f, 0x84]);
    b.writeInt32LE(0xe60 - 0xf30, 0xf2c);
    b[0xf30] = 0xe9; b.writeInt32LE(0xfe0 - 0xf35, 0xf31);
    expect(discoverCxProfiles(b)).toHaveLength(1);
    expect(discoverCxProfiles(b)[0].oddBranchOrder).toEqual(profile().oddBranchOrder);
  });
  it("extracts only complete bounded zlib PE records and rejects trailing bytes/oversized declarations", () => {
    const pe = fixture(); const packed = deflateSync(pe);
    const record = (extra = Buffer.alloc(0), size = pe.length) => {
      const head = Buffer.alloc(40); head.write("internal module\0"); head.writeUInt32LE(size, 24);
      head.writeUInt32LE(packed.length + extra.length, 28);
      return Buffer.concat([head.subarray(0, 32), packed, extra]);
    };
    expect(extractEmbeddedPeModules(record())).toEqual([pe]);
    expect(extractEmbeddedPeModules(record(Buffer.from([0, 1])))).toEqual([]);
    expect(extractEmbeddedPeModules(record(Buffer.alloc(0), 65 * 1024 * 1024))).toEqual([]);
    expect(extractEmbeddedPeModules(record(Buffer.alloc(0), pe.length - 1))).toEqual([]);
    expect(extractEmbeddedPeModules(record().subarray(0, 50))).toEqual([]);
    expect(extractEmbeddedPeModules(Buffer.concat([record(), record()]))).toHaveLength(2);
  });
  it("rejects the second declared expansion before inflate when cumulative embedded PE bytes exceed 64 MiB", () => {
    const pe = tinyPE(), compressed = deflateSync(pe);
    const record = (expanded: number) => {
      const header = Buffer.alloc(32); header.write("internal module\0");
      header.writeUInt32LE(expanded, 24); header.writeUInt32LE(compressed.length, 28);
      return Buffer.concat([header, compressed]);
    };
    // Only a few KiB of compressed data: no GiB-sized payload or allocation is required.
    const bomb = Buffer.concat([record(pe.length), record(64 * 1024 * 1024)]);
    const inflate = vi.mocked(inflateSync); inflate.mockClear();
    expect(() => extractEmbeddedPeModules(bomb)).toThrow(/CX_MODULE_LIMIT/u);
    expect(inflate).toHaveBeenCalledTimes(1);
  });
  it("accepts an exact caller expansion budget, rejects a smaller one before inflation and enforces the hard ceiling", () => {
    const pe = tinyPE(), compressed = deflateSync(pe);
    const record = (expanded = pe.length) => {
      const header = Buffer.alloc(32); header.write("internal module\0");
      header.writeUInt32LE(expanded, 24); header.writeUInt32LE(compressed.length, 28);
      return Buffer.concat([header, compressed]);
    };
    const input = Buffer.concat([record(), record()]);
    expect(extractEmbeddedPeModules(input, {maxTotalBytes: pe.length * 2})).toHaveLength(2);
    const inflate = vi.mocked(inflateSync); inflate.mockClear();
    expect(() => extractEmbeddedPeModules(input, {maxTotalBytes: pe.length * 2 - 1})).toThrow(/CX_MODULE_LIMIT/u);
    expect(inflate).toHaveBeenCalledTimes(1);
    inflate.mockClear();
    expect(() => extractEmbeddedPeModules(record(), {maxTotalBytes: 0})).toThrow(/CX_MODULE_LIMIT/u);
    expect(inflate).not.toHaveBeenCalled();
    expect(() => extractEmbeddedPeModules(Buffer.concat([record(), record(64 * 1024 * 1024)]),
      {maxTotalBytes: 1024 * 1024 * 1024})).toThrow(/CX_MODULE_LIMIT/u);
    for (const maxTotalBytes of [-1, NaN, Infinity, 1.5]) {
      expect(() => extractEmbeddedPeModules(input, {maxTotalBytes})).toThrow(/CX_MODULE_LIMIT/u);
    }
    // A failed size/PE validation still consumed an attempted declaration.
    inflate.mockClear();
    expect(() => extractEmbeddedPeModules(Buffer.concat([record(pe.length + 1), record()]),
      {maxTotalBytes: pe.length * 2})).toThrow(/CX_MODULE_LIMIT/u);
    expect(inflate).toHaveBeenCalledTimes(1);
  });
});
