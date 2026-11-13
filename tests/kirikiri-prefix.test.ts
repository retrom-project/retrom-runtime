// @vitest-environment node
import {describe, expect, it} from "vitest";
import {createPrefixFilter, discoverPrefixProfiles} from "../scripts/kirikiri/prefix-xor.mjs";
import {prefixPE} from "./kirikiri-prefix-fixture.mjs";

describe("registered prefix-preserving XP3 filter", () => {
  it.each([[9, 11], [17, 47]])("recovers shift %i and boundary %i from the connected callback", (shift, boundary) => {
    const module = prefixPE(shift, boundary), original = Buffer.from(module);
    expect(discoverPrefixProfiles(module)).toEqual([{shift, boundary}]);
    expect(module).toEqual(original);
  });
  it.each(["abi", "seed", "offset", "buffer", "registration", "resolver", "api"])("rejects altered %s evidence", defect => {
    const module = prefixPE();
    const offsets = {abi: 0x80a, seed: 0x831, offset: 0x845, buffer: 0x857, registration: 0xa29, resolver: 0xa1c, api: 0x2710};
    module[offsets[defect as keyof typeof offsets]] ^= 1;
    expect(discoverPrefixProfiles(module)).toEqual([]);
  });
  it("retains the prefix and absolute offsets across split and large reads", () => {
    const filter = createPrefixFilter({shift: 9, boundary: 11});
    const source = Uint8Array.from({length: 70000}, (_, i) => i % 251), expected = source.map((byte, index) => index <= 11 ? byte : byte ^ 0x6d);
    const actual = source.slice(), cuts = [0, 1, 11, 12, 13, 4095, 65536, source.length];
    for (let i = 1; i < cuts.length; i++) filter.apply(actual.subarray(cuts[i - 1], cuts[i]), 0x246da00, cuts[i - 1]);
    expect(actual).toEqual(expected);
    expect(filter.apply(actual, 0x246da00)).toEqual(source);
    expect(filter.apply(Uint8Array.of(1, 2), 0x246da00, 0x100000000)).toEqual(Uint8Array.of(1 ^ 0x6d, 2 ^ 0x6d));
  });
  it("keeps zero keys intact and rejects invalid profiles and ranges", () => {
    const filter = createPrefixFilter({shift: 9, boundary: 11});
    expect(filter.unchangedSeed(1)).toBe(true);
    expect(filter.apply(Uint8Array.of(1, 2, 3), 1, 100)).toEqual(Uint8Array.of(1, 2, 3));
    expect(() => createPrefixFilter({shift: 32, boundary: 11})).toThrow(/invalid prefix profile/u);
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER]) expect(() => filter.apply(Uint8Array.of(1, 2), 1, offset)).toThrow(/invalid resource range/u);
  });
});
