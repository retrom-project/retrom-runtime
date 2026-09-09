import {describe, expect, it} from "vitest";
import {decodeSave, encodeSave} from "./save.js";
const identity = "a".repeat(64);
describe("OpenBOR native save transfer", () => {
  it("round-trips a nonempty file bundle bound to the game content", () => {
    const files = [["game.s00", Uint8Array.of(5)], ["game.sav", Uint8Array.of(1, 2, 3)]] as const;
    const saved = encodeSave(identity, files);
    expect(decodeSave(saved, identity)).toEqual(files);
    expect(() => decodeSave(saved, "b".repeat(64))).toThrow("OPENBOR_SAVE_INVALID");
  });
  it("rejects empty saves, path escapes, duplicates, and malformed input", () => {
    for (const files of [[], [["../escape", Uint8Array.of(1)]], [["game.cfg", Uint8Array.of(1)]],
      [["game.sav", Uint8Array.of(1)], ["game.sav", Uint8Array.of(2)]]]) {
      expect(() => encodeSave(identity, files as [string, Uint8Array][])).toThrow();
    }
    const invalidName = new TextEncoder().encode(JSON.stringify({version: 1, identity,
      files: [["game.sav", "AQ=="], [["game.s00"], "AQ=="]]}));
    expect(() => decodeSave(invalidName, identity)).toThrow("OPENBOR_SAVE_INVALID");
    expect(() => decodeSave(Uint8Array.of(0), identity)).toThrow("OPENBOR_SAVE_INVALID");
  });
});
