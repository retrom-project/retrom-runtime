// @vitest-environment node
import {describe, expect, it} from "vitest";
import {createInlineFilter, discoverInlineProfiles} from "../scripts/kirikiri/inline-xor.mjs";
import {inlineCrypt, inlinePE} from "./kirikiri-inline-fixture.js";

describe("inline archive filtering", () => {
  it("recovers parameters without changing the module and uses absolute read offsets", () => {
    const module = inlinePE(), original = Buffer.from(module), profiles = discoverInlineProfiles(module);
    expect(profiles).toEqual([{shifts: [8, 8, 1, 7, 5], mask: 4, boundary: 100}]);
    expect(module).toEqual(original);
    const filter = createInlineFilter(profiles[0]), source = Buffer.alloc(70000, 0x93), expected = inlineCrypt(Buffer.from(source), 0xf3542917);
    const pieces = Buffer.from(source), cuts = [0, 1, 99, 100, 101, 102, 104, 108, 65536, pieces.length];
    for (let i = 1; i < cuts.length; i++) filter.apply(pieces.subarray(cuts[i - 1], cuts[i]), 0xf3542917, cuts[i - 1]);
    expect(pieces).toEqual(expected); expect(filter.apply(pieces, 0xf3542917)).toEqual(source);
  });
  it("reads different shift, boundary and mask parameters from connected instructions", () => {
    const module = inlinePE(); module[0x909] = 9; module[0x919] = 6; module[0x92a] = 3;
    module.writeUInt32LE(3, 0x936); module[0x94f] = 31;
    expect(discoverInlineProfiles(module)).toEqual([{shifts: [9, 9, 1, 6, 3], mask: 3, boundary: 31}]);
  });
  it.each(["record", "call", "guard", "seed", "offset", "table", "limit"])("rejects a disconnected or altered %s", defect => {
    const module = inlinePE();
    const offsets = {record: 0x1102, call: 0x900 - 40, guard: 0x900 - 31, seed: 0x902, offset: 0x945, table: 0x95d, limit: 0x96f};
    module[offsets[defect as keyof typeof offsets]] ^= 1;
    expect(discoverInlineProfiles(module)).toEqual([]);
  });
  it("rejects invalid profile fields and unbounded resource ranges", () => {
    const profile = discoverInlineProfiles(inlinePE())[0];
    expect(() => createInlineFilter({...profile, mask: 7})).toThrow(/invalid inline profile/u);
    const filter = createInlineFilter(profile);
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER]) expect(() => filter.apply(Buffer.alloc(2), 1, offset)).toThrow(/invalid resource range/u);
  });
});
