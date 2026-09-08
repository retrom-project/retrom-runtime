import {webcrypto} from "node:crypto";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {decodeScummvmSave, encodeScummvmSave} from "./checkpoint.js";

const identity = "a".repeat(64);
const files = [{path: "SKY-VM.007", data: new Uint8Array([1, 2, 3])}, {path: "SKY-VM.SAV", data: new Uint8Array([4, 5])}];
beforeEach(() => {vi.stubGlobal("crypto", webcrypto);});

describe("ScummVM native save bundles", () => {
  it("preserves the explicit slot and all companion files across a fresh decode", async () => {
    const bytes = await encodeScummvmSave({identity, resumeSlot: 7, files});
    const decoded = await decodeScummvmSave(bytes, identity);
    expect(decoded).toEqual({identity, resumeSlot: 7, files});
    files[0].data[0] = 9;
    expect(decoded.files[0].data[0]).toBe(1);
    files[0].data[0] = 1;
  });

  it("preserves manual restoration when no exact slot was requested", async () => {
    const encoded = await encodeScummvmSave({identity, resumeSlot: null, files});
    expect((await decodeScummvmSave(encoded, identity)).resumeSlot).toBeNull();
  });

  it("rejects another game's data, corruption, trailing bytes, and empty persistence", async () => {
    const encoded = await encodeScummvmSave({identity, resumeSlot: 7, files});
    await expect(decodeScummvmSave(encoded, "b".repeat(64))).rejects.toThrow("SCUMMVM_SAVE_INVALID");
    const corrupt = encoded.slice(); corrupt[corrupt.length - 1] ^= 1;
    await expect(decodeScummvmSave(corrupt, identity)).rejects.toThrow("SCUMMVM_SAVE_INVALID");
    await expect(decodeScummvmSave(new Uint8Array([...encoded, 0]), identity)).rejects.toThrow("SCUMMVM_SAVE_INVALID");
    await expect(encodeScummvmSave({identity, resumeSlot: null, files: []})).rejects.toThrow("SCUMMVM_SAVE_INVALID");
  });

  it.each(["../outside", "/saves/save", "a/b", "a\\b", "scummvm.ini"])("rejects unsafe or non-save paths: %s", async (path) => {
    await expect(encodeScummvmSave({identity, resumeSlot: 7, files: [{path, data: new Uint8Array([1])}]}))
      .rejects.toThrow("SCUMMVM_SAVE_INVALID");
  });
});
