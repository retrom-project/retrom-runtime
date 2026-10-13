import {describe, expect, it} from "vitest";
import {createRetromDefaultControls} from "./default-controls.js";

// Native slots come from the cores' input descriptors, not from EJS button names.
// Press and release must each reach exactly one native input.
function delivered(core: string, physical: string, pressed: boolean, gameUrl = "game.md") {
  return Object.entries(createRetromDefaultControls(core, gameUrl)[0])
    .filter(([, binding]) => binding.value2 === physical)
    .map(([slot]) => [Number(slot), pressed ? 1 : 0]);
}

describe("standard gamepad native actions", () => {
  it.each([
    "fbalpha", "fbneo", "fbalpha2012_cps1", "fbalpha2012_cps2", "mame2003", "mame2003_plus",
    "supermodel", "pcsx_rearmed", "mednafen_psx_hw", "ppsspp", "atari800", "a5200",
    "freechaf", "hatarib",
    "vice_x128", "vice_x64", "vice_x64sc", "vice_xpet", "vice_xplus4", "vice_xvic",
    "daphne", "dosbox_pure", "flycast", "neocd", "o2em", "puae",
  ])("sends positional actions once on %s", core => {
    for (const [index, native] of [0, 8, 1, 9].entries()) {
      expect(delivered(core, `BUTTON_${index + 1}`, true)).toEqual([[native, 1]]);
      expect(delivered(core, `BUTTON_${index + 1}`, false)).toEqual([[native, 0]]);
    }
  });
  it.each(["mednafen_ngp", "smsplus", "prosystem", "stella2014", "81", "theodore"])("puts the primary action on bottom for %s", core => {
    expect(delivered(core, "BUTTON_1", true)).toEqual([[0, 1]]);
    expect(delivered(core, "BUTTON_2", true)).toEqual([[8, 1]]);
  });
  it.each(["mupen64plus_next", "parallel_n64"])("uses retained N64 A/B slots for %s", core => {
    expect(delivered(core, "BUTTON_1", true)).toEqual([[0, 1]]);
    expect(delivered(core, "BUTTON_2", true)).toEqual([[1, 1]]);
    expect(delivered(core, "RIGHT_STICK_X:+1", true)).toEqual([[20, 1]]);
  });
  it.each(["genesis_plus_gx", "genesis_plus_gx_wide", "picodrive"])("separates SMS/GG from six-button Sega on %s", core => {
    for (const file of ["game.sms", "game.GG", "game.sg"]) {
      expect(delivered(core, "BUTTON_1", true, file)).toEqual([[0, 1]]);
      expect(delivered(core, "BUTTON_2", true, file)).toEqual([[8, 1]]);
    }
    const bindings = ["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "RIGHT_TOP_SHOULDER", "LEFT_TOP_SHOULDER"];
    for (const [i, slot] of [1, 0, 10, 9, 8, 11].entries()) {
      expect(delivered(core, bindings[i], true)).toEqual([[slot, 1]]);
    }
  });
  it("maps Saturn A/B/X/Y with C/Z on shoulders", () => {
    for (const [i, slot] of [1, 0, 9, 10, 8, 11].entries()) {
      const binding = ["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "RIGHT_TOP_SHOULDER", "LEFT_TOP_SHOULDER"][i];
      expect(delivered("yabause", binding, true)).toEqual([[slot, 1]]);
    }
  });
  it("maps 3DO A/B/C rather than C/B/A", () => {
    for (const [i, slot] of [1, 0, 8].entries()) {
      expect(delivered("opera", `BUTTON_${i + 1}`, true)).toEqual([[slot, 1]]);
    }
  });
  it.each(["bsnes", "snes9x", "desmume", "desmume2015", "melonds", "azahar", "gearboy", "ardens", "sameduck", "potator", "freeintv", "fuse", "prboom", "lutro", "same_cdi"])("preserves native letter actions on %s", core => {
    for (const [i, slot] of [8, 0, 9, 1].entries()) {
      expect(delivered(core, `BUTTON_${i + 1}`, true)).toEqual([[slot, 1]]);
    }
  });
});
