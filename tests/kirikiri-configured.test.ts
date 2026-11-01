// @vitest-environment node
import {describe, expect, it} from "vitest";
import {createConfiguredFilter, discoverConfiguredProfiles} from "../scripts/kirikiri/configured-cx.mjs";
import {configuredPE} from "./kirikiri-configured-fixture.js";

describe("configured native XP3 filter", () => {
  it("recovers connected module parameters and applies them consistently across split reads", () => {
    const module = configuredPE(), before = Buffer.from(module), profiles = discoverConfiguredProfiles(module);
    expect(profiles).toHaveLength(1);
    expect(module).toEqual(before);
    const filter = createConfiguredFilter(profiles[0]), original = Buffer.alloc(70000, 0xa9);
    const whole = filter.apply(Buffer.from(original), 0xf8e4a3c2);
    const pieces = Buffer.from(original), cuts = [0, 1, 31, 32, 47, 63, 64, 251, 32767, 65536, pieces.length];
    for (let i = 1; i < cuts.length; i++) filter.apply(pieces.subarray(cuts[i - 1], cuts[i]), 0xf8e4a3c2, cuts[i - 1]);
    expect(pieces).toEqual(whole);
    expect(filter.apply(whole, 0xf8e4a3c2)).toEqual(original);
  });

  it.each(["record", "permutation", "random-mode", "parser", "callback", "random-generator"])(
    "rejects an unsupported or disconnected module: %s", defect => {
      const module = configuredPE();
      if (defect === "record") module[0x3000] ^= 1;
      if (defect === "permutation") module[0x3011] = module[0x3012];
      if (defect === "random-mode") module[0x3022] = 0x80;
      if (defect === "parser") module[0x601] ^= 1;
      if (defect === "callback") module[0xa07] = 16;
      if (defect === "random-generator") module[0xc08] ^= 1;
      expect(discoverConfiguredProfiles(module)).toEqual([]);
    });
});
