// @vitest-environment node
import {describe, expect, it} from "vitest";
import {createRollingFilter, discoverRollingProfiles} from "../scripts/kirikiri/rolling-xor.mjs";
import {inlineRollingPE, rollingPE} from "./kirikiri-rolling-fixture.js";

describe("module-supplied rolling XOR", () => {
  it("retains absolute positions across arbitrary split reads", () => {
    const module = rollingPE(), original = Buffer.from(module), profiles = discoverRollingProfiles(module);
    expect(profiles).toHaveLength(1); expect(module).toEqual(original);
    const filter = createRollingFilter(profiles[0]), source = Buffer.alloc(70000, 0xa5);
    const whole = filter.apply(Buffer.from(source), 0xf3a5b712);
    const pieces = Buffer.from(source), cuts = [0, 1, 30, 31, 32, 61, 93, 4097, 65536, pieces.length];
    for (let i = 1; i < cuts.length; i++) filter.apply(pieces.subarray(cuts[i - 1], cuts[i]), 0xf3a5b712, cuts[i - 1]);
    expect(pieces).toEqual(whole); expect(filter.apply(whole, 0xf3a5b712)).toEqual(source);
  });
  it.each(["setter", "callback", "record", "seed", "rotation", "consumer"])("ignores a disconnected or modified %s", defect => {
    const module = rollingPE();
    if (defect === "setter") module[0x801] ^= 1;
    if (defect === "callback") module[0x80b] ^= 1;
    if (defect === "record") module[0xa17] ^= 1;
    if (defect === "seed") module[0xa40] ^= 1;
    if (defect === "rotation") module[module.indexOf(Buffer.from([0x30, 0x4c, 0x15, 0xdc]), 0xa00)] ^= 1;
    if (defect === "consumer") module[module.indexOf(Buffer.from([0x8b, 0x77, 0x0c, 0x33, 0xc0]), 0xa00)] ^= 1;
    expect(discoverRollingProfiles(module)).toEqual([]);
  });
});

describe("engine-owned rolling XOR", () => {
  it.each([8, 32, 64])("derives the seed XOR and %i-byte table from a connected stream", length => {
    const module = inlineRollingPE(0x87654321, length), original = Buffer.from(module), profiles = discoverRollingProfiles(module);
    expect(profiles).toHaveLength(1); expect(module).toEqual(original);
    expect(profiles[0].xorConstant).toBe(0x87654321); expect(profiles[0].table).toHaveLength(length);
    const seed = 0xf3a5b712, source = Buffer.alloc(70000, 0xa5), expected = Buffer.from(source);
    // Independent 31-bit rotation model, with a resource offset crossing a period.
    let bits = BigInt((seed ^ 0x87654321) >>> 0) & 0x7fffffffn;
    const table = Array.from({length}, () => {
      const value = Number(bits & 255n);
      bits = (bits >> 8n | bits << 23n) & 0x7fffffffn;
      return value;
    });
    for (let i = 0; i < expected.length; i++) {expected[i] ^= table[i % length];}
    const filter = createRollingFilter(profiles[0]), whole = filter.apply(Buffer.from(source), seed), pieces = Buffer.from(source);
    const cuts = [0, 1, 31, 32, 63, 96, 4097, 65536, pieces.length];
    for (let i = 1; i < cuts.length; i++) {filter.apply(pieces.subarray(cuts[i - 1], cuts[i]), seed, cuts[i - 1]);}
    expect(whole).toEqual(expected); expect(pieces).toEqual(whole); expect(filter.apply(whole, seed)).toEqual(source);
  });
  it.each(["type", "locator", "vtable", "seed", "rotation", "bound", "generatorBranch", "consumer", "consumerBranch"])("ignores disconnected or inconsistent %s", defect => {
    const module = inlineRollingPE();
    if (defect === "type") {module[0x3008] ^= 1;}
    if (defect === "locator") {module[0x310c] ^= 1;}
    if (defect === "vtable") {module[0x3204] ^= 1;}
    if (defect === "seed") {module[0x1100] ^= 1;}
    if (defect === "rotation") {module[0x113e] ^= 1;}
    if (defect === "bound") {module[0x1146] ^= 1;}
    if (defect === "generatorBranch") {module[0x1148] ^= 1;}
    if (defect === "consumer") {module[0x115b] ^= 1;}
    if (defect === "consumerBranch") {module[0x1167] ^= 1;}
    expect(discoverRollingProfiles(module)).toEqual([]);
  });
});
