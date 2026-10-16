import {describe, expect, it} from "vitest";
import {decodeSave, encodeSave, hasProgress, maximumSaveBytes, type SaveFiles} from "./checkpoint.js";
const identity = "a".repeat(64);
const progress = {"sjs_save.bin": new Uint8Array([1, 2]), "sjs_save_000.bin": new Uint8Array([3, 4, 5])};
describe("Shiina native saves", () => {
  it("preserves every original save byte with stable ordering and an explicit identity", () => {
    const bytes = encodeSave(identity, progress);
    expect(decodeSave(bytes, identity)).toEqual(progress);
    expect(encodeSave(identity, {"sjs_save_000.bin": progress["sjs_save_000.bin"], "sjs_save.bin": progress["sjs_save.bin"]})).toEqual(bytes);
    expect(() => decodeSave(bytes, "b".repeat(64))).toThrow("SHIINA_SAVE_INVALID");
  });
  it("does not classify global settings or the engine's startup continuation as progress", () => {
    expect(hasProgress({"sjs_save.bin": new Uint8Array([1]), "sjs_save_103.bin": new Uint8Array([2])})).toBe(false);
    expect(hasProgress(progress)).toBe(true);
    expect(hasProgress({"sjs_save_019.bin": new Uint8Array()})).toBe(false);
  });
  it("rejects unsafe names, duplicate case, empty progress and oversized state", () => {
    const invalid: SaveFiles[] = [{}, {"../save.bin": new Uint8Array([1])}, {...progress, "SJS_SAVE.BIN": new Uint8Array([1])},
      {"sjs_save_000.bin": new Uint8Array(maximumSaveBytes)}];
    for (const files of invalid) {
      expect(() => encodeSave(identity, files)).toThrow("SHIINA_SAVE_INVALID");
    }
  });
  it("rejects corruption, truncation, trailing bytes and an oversized container before decoding", () => {
    const bytes = encodeSave(identity, progress), corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
    for (const value of [corrupt, bytes.subarray(0, bytes.length - 1), new Uint8Array([...bytes, 0]), new Uint8Array(maximumSaveBytes + 1)]) {
      expect(() => decodeSave(value, identity)).toThrow("SHIINA_SAVE_INVALID");
    }
  });
});
