// @vitest-environment node
import {expect, it} from "vitest";
import {createTinyFilter, discoverTinyProfiles} from "../scripts/kirikiri/cxdec.mjs";
import {tinyFirstBytePE} from "./kirikiri-pe-fixture.js";

const profile = {xorConstant: 0x12345678, zeroFallback: 0x55, firstByte: {zeroFallback: 0x69}};

it("applies both independently specified Tiny keys at absolute byte zero", () => {
  // h XOR C = 0x10203040: bulk=0x40 and first=0x40, so only byte zero cancels.
  const filter = createTinyFilter(profile), bytes = Uint8Array.from([0, 1, 2, 3, 4]);
  expect(filter.apply(bytes, 0x02146638)).toBe(bytes);
  expect([...bytes]).toEqual([0, 0x41, 0x42, 0x43, 0x44]);
  filter.apply(bytes, 0x02146638);
  expect([...bytes]).toEqual([0, 1, 2, 3, 4]);
  const ordinary = createTinyFilter({...profile, firstByte: undefined});
  expect([...ordinary.apply(new Uint8Array(3), 0x02146638)]).toEqual([0x40, 0x40, 0x40]);
});

it("keeps first-byte semantics through empty chunks, split reads and 64-bit offsets", () => {
  const filter = createTinyFilter(profile), hash = 0x91ac2e77;
  const whole = filter.apply(new Uint8Array(131073).fill(7), hash), pieces = new Uint8Array(whole.length).fill(7);
  filter.apply(new Uint8Array(), hash, 0n);
  const cuts = [0, 1, 32767, 65536, pieces.length];
  for (let i = 1; i < cuts.length; i++) filter.apply(pieces.subarray(cuts[i - 1], cuts[i]), hash, BigInt(cuts[i - 1]));
  expect(pieces).toEqual(whole);
  expect(filter.apply(new Uint8Array(20).fill(7), hash, 32767)).toEqual(whole.subarray(32767, 32787));
  expect(filter.apply(new Uint8Array(3).fill(7), hash, 0x100000000n)).toEqual(whole.subarray(1, 4));
});

it("uses each zero-key fallback independently and captures profile values", () => {
  const parameters = {...profile, firstByte: {...profile.firstByte}}, filter = createTinyFilter(parameters);
  parameters.xorConstant = 0; parameters.firstByte.zeroFallback = 1;
  // t=0 -> bulk fallback 0x55, first fallback 0x69.
  expect([...filter.apply(new Uint8Array(2), profile.xorConstant, 0n)]).toEqual([0x3c, 0x55]);
  // t=0x01010101 -> only bulk is zero; t=0x100 -> only first is zero.
  expect([...filter.apply(new Uint8Array(2), 0x13355779)]).toEqual([0x54, 0x55]);
  expect([...filter.apply(new Uint8Array(2), 0x12345778)]).toEqual([0x68, 1]);
});

it("rejects invalid profiles, seeds and offsets before changing any byte", () => {
  for (const bad of [0, -1, 256, 1.5]) {
    expect(() => createTinyFilter({...profile, zeroFallback: bad})).toThrow(/CX_PROFILE/u);
    expect(() => createTinyFilter({...profile, firstByte: {zeroFallback: bad}})).toThrow(/CX_PROFILE/u);
  }
  expect(() => createTinyFilter({...profile, xorConstant: 0x100000000})).toThrow(/CX_PROFILE/u);
  const filter = createTinyFilter(profile), bytes = new Uint8Array(3).fill(7);
  for (const offset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, -1n, 0xffffffffffffffffn]) {
    expect(() => filter.apply(bytes, 0, offset)).toThrow(/CX_OFFSET/u);
  }
  expect(() => filter.apply(bytes, -1)).toThrow(/CX_HASH/u);
  expect(bytes).toEqual(new Uint8Array(3).fill(7));
});

it("rejects disconnected dual-key constructors and invalid first-byte consumers", () => {
  // Mutations break the data source, object field, zero guard or linked consumer.
  for (const [at, value] of [[0x1518, 0xc1], [0x152d, 0x57], [0x1533, 0x74],
    [0x1537, 6], [0x170e, 0x90], [0x1715, 0x74], [0x171a, 6], [0x171d, 4], [0x2605, 0x24]]) {
    const bytes = tinyFirstBytePE(); bytes[at] = value;
    expect(discoverTinyProfiles(bytes), `mutated offset ${at.toString(16)}`).toEqual([]);
  }
});

it("does not collapse bulk-only and first-byte profiles found in the same PE", () => {
  const bytes = tinyFirstBytePE();
  // A second constructor has the same constant/fallback but returns after its bulk key.
  bytes.subarray(0x1500, 0x152c).copy(bytes, 0x1800); bytes[0x182c] = 0xc3;
  const found = discoverTinyProfiles(bytes);
  expect(found).toHaveLength(2);
  expect(found.filter(p => p.firstByte)).toHaveLength(1);
});

it("rejects an interleaved MOV that destroys the middle byte before its XOR", () => {
  const bytes = tinyFirstBytePE();
  bytes[0x1519] = 0xca; bytes[0x151d] = 0xe9; bytes[0x1520] = 0xd9;
  expect(discoverTinyProfiles(bytes)).toEqual([]);
});
