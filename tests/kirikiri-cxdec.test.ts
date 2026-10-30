// @vitest-environment node
import {createHash} from "node:crypto";
import {deflateSync, inflateSync} from "node:zlib";
import {describe, expect, it, vi} from "vitest";
import {createCxFilter, discoverCxProfiles, discoverTinyProfiles, extractEmbeddedPeModules} from "../scripts/kirikiri/cxdec.mjs";
import {tinyPE, tinyFirstBytePE} from "./kirikiri-pe-fixture.js";
import {profile, fixture, delegatedFixture, stackCallbackFixture} from "./kirikiri-classic-fixture.js";

vi.mock("node:zlib", async () => {
  const actual = await vi.importActual<typeof import("node:zlib")>("node:zlib");
  return {...actual, inflateSync: vi.fn(actual.inflateSync)};
});

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

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
  it("recovers a stack-record callback and follows only its successful conditional emission tail", () => {
    const b = stackCallbackFixture();
    expect(discoverCxProfiles(b)).toHaveLength(1);
    expect(discoverCxProfiles(b)[0]).toMatchObject(profile());
    const wrongArgument = Buffer.from(b); wrongArgument[0x1609] = 20;
    expect(discoverCxProfiles(wrongArgument)).toEqual([]);
    const wrongSeed = Buffer.from(b); wrongSeed[0x160d] = 16;
    expect(discoverCxProfiles(wrongSeed)).toEqual([]);
    const failureTail = Buffer.from(b); failureTail[0xf2d] = 0x84;
    expect(discoverCxProfiles(failureTail)).toEqual([]);
  });
  it("connects a delegated ABI record and scheduled seed to a stack manager with an executable control table", () => {
    const found = discoverCxProfiles(delegatedFixture());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({...profile(), legacyBulk: true});
    const wrongABI = delegatedFixture(); wrongABI[0x1602] = 20;
    expect(discoverCxProfiles(wrongABI)[0]?.legacyBulk).not.toBe(true);
    const wrongRecord = delegatedFixture(); wrongRecord[0x1620] = 0x57;
    expect(discoverCxProfiles(wrongRecord)[0]?.legacyBulk).not.toBe(true);
    const missingFold = delegatedFixture(); missingFold[0x173b] = 15;
    expect(discoverCxProfiles(missingFold)[0]?.legacyBulk).not.toBe(true);
  });
  it("rejects a delegated callback after its record pointer has been overwritten", () => {
    const b = delegatedFixture();
    b.copyWithin(0x1709, 0x1707, 0x1722);
    b.set([0x8b, 0xf0], 0x1707); // mov esi,eax between argument load and seed load
    expect(discoverCxProfiles(b)[0]?.legacyBulk).not.toBe(true);
  });
  it.each([0xc3, 0xb8])("rejects a seed load reached through a return or operand byte (%i)", opcode => {
    const b = delegatedFixture();
    b.copyWithin(0x1708, 0x1707, 0x1722);
    b[0x1707] = opcode; // RET before the seed, or MOV eax,imm32 containing its bytes
    expect(discoverCxProfiles(b)[0]?.legacyBulk).not.toBe(true);
  });
  it("keeps a delegated record through independent register scheduling", () => {
    const b = delegatedFixture();
    b.copyWithin(0x1709, 0x1707, 0x1722);
    b.set([0x8b, 0xc0], 0x1707); // mov eax,eax preserves the forwarded esi
    expect(discoverCxProfiles(b)[0]?.legacyBulk).toBe(true);
  });
  it("rejects a manager call in unreachable bytes after the region consumer returns", () => {
    const b = delegatedFixture();
    const va = (off: number) => 0x10000000 + (off < 0x2400 ? off + 0xc00 : off + 0x1c00);
    b.fill(0x90, 0x1800, 0x1810);
    b[0x1800] = 0xc3;
    b[0x1808] = 0xe8;
    b.writeInt32LE(va(0x480) - va(0x1808) - 5, 0x1809);
    b[0x180d] = 0xc3;
    expect(discoverCxProfiles(b)[0]?.legacyBulk).not.toBe(true);
  });
  it.each(["immediate", "jump", "manager-return"])("rejects an unconnected manager call hidden by %s", shape => {
    const b = delegatedFixture();
    const va = (off: number) => 0x10000000 + (off < 0x2400 ? off + 0xc00 : off + 0x1c00);
    b.fill(0x90, 0x1800, 0x1811);
    const call = shape === "immediate" ? 0x1801 : 0x1808;
    b[call] = 0xe8;
    b.writeInt32LE(va(shape === "manager-return" ? 0x470 : 0x480) - va(call) - 5, call + 1);
    b[call + 5] = 0xc3;
    if (shape === "immediate") {b[0x1800] = 0xb8;}
    if (shape === "jump") {b.set([0xeb, 14], 0x1800); b[0x1810] = 0xc3;}
    if (shape === "manager-return") {b[0x470] = 0xc3;}
    expect(discoverCxProfiles(b)[0]?.legacyBulk).not.toBe(true);
  });
  it.each([false, true])("follows a reachable manager call through local branch edges, conditional=%s", conditional => {
    const b = delegatedFixture();
    const va = (off: number) => 0x10000000 + (off < 0x2400 ? off + 0xc00 : off + 0x1c00);
    b.fill(0x90, 0x1800, 0x1811);
    b.set(conditional ? [0x85, 0xc0, 0x74, 12] : [0xeb, 6, 0xc3], 0x1800);
    const call = conditional ? 0x1804 : 0x1808;
    b[call] = 0xe8;
    b.writeInt32LE(va(0x480) - va(call) - 5, call + 1);
    b[call + 5] = b[0x1810] = 0xc3;
    expect(discoverCxProfiles(b)[0]?.legacyBulk).toBe(true);
  });
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
