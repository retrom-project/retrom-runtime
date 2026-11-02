// @vitest-environment node
import {describe, expect, it} from "vitest";
import {createRollingFilter, discoverRollingProfiles} from "../scripts/kirikiri/rolling-xor.mjs";
import {rollingPE} from "./kirikiri-rolling-fixture.js";

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
