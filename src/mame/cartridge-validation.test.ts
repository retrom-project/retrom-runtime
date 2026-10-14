import {expect, it} from "vitest";
import {validGameSize, validateGame} from "./profiles.js";

it.each([["pv1000", 32768], ["coleco", 32768], ["sg1000", 65536]] as const)(
  "accepts unpadded %s cartridge images within the machine address space", (machine, limit) => {
    for (const size of [1, 8191, 8192, 12113, 15955, 23808, limit]) {
      const bytes = new Uint8Array(size).fill(0x5a);
      expect(validGameSize(machine, size)).toBe(true);
      expect(() => validateGame(machine, bytes)).not.toThrow();
      expect(bytes.every(byte => byte === 0x5a)).toBe(true);
    }
    for (const size of [0, limit + 1]) {
      expect(() => validateGame(machine, new Uint8Array(size))).toThrow("MAME_CONTENT_INVALID");
    }
    for (const size of [-1, 0.5, Infinity, NaN]) {expect(validGameSize(machine, size)).toBe(false);}
  },
);
