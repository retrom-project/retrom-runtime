import {describe, expect, it} from "vitest";
import {decodeCheckpoint, encodeCheckpoint} from "./state.js";
const identity = "a".repeat(64);
describe("PX68K checkpoint envelope", () => {
  it("restores state and the writable disk together", () => {
    const files = {"disk0.dim": new Uint8Array([1, 2, 3])};
    const bytes = encodeCheckpoint(identity, new Uint8Array([4, 5]), files, 120);
    const restored = decodeCheckpoint(identity, bytes);
    expect(restored.state).toEqual(new Uint8Array([4, 5]));
    expect(restored.files).toEqual(files);
    expect(restored.frames).toBe(120);
  });
  it("rejects another game, corrupt data, empty state and escaped disk paths", () => {
    const bytes = encodeCheckpoint(identity, new Uint8Array([7]), {}, 0);
    expect(() => decodeCheckpoint("b".repeat(64), bytes)).toThrow();
    expect(() => decodeCheckpoint(identity, bytes.slice(0, -1))).toThrow();
    expect(() => encodeCheckpoint(identity, new Uint8Array(), {}, 0)).toThrow();
    expect(() => encodeCheckpoint(identity, new Uint8Array([1]), {"../bios": new Uint8Array([1])}, 0)).toThrow();
  });
});
