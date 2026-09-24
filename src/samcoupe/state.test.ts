import {expect, it} from "vitest";

import {decodeSamDisk, encodeSamDisk, saveFormat} from "./state.js";

it("binds a SAM disk save to its source game and checks the complete disk bytes", () => {
  const game = "0".repeat(64);
  const stored = encodeSamDisk(game, Uint8Array.of(1, 2, 3));
  expect(saveFormat).toBe("samcoupe-disk-save-v1");
  expect(decodeSamDisk(game, stored)).toEqual(Uint8Array.of(1, 2, 3));
  expect(() => decodeSamDisk("1".repeat(64), stored)).toThrow("SAMCOUPE_SAVE_INVALID");
  stored[stored.length - 1] ^= 1;
  expect(() => decodeSamDisk(game, stored)).toThrow("SAMCOUPE_SAVE_INVALID");
});
