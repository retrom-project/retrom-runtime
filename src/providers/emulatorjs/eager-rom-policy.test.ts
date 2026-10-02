import {expect, it} from "vitest";
import {emulatorContentPolicies} from "../../provider/content-policies.js";

it.each(["fceumm", "nestopia", "mgba", "snes9x"])("owns persistent eager ROM and BIOS bytes for %s", core => {
  expect(emulatorContentPolicies(core).game.mode).toBe("EAGER");
  expect(emulatorContentPolicies(core).bios.mode).toBe("EAGER");
});
