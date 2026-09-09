import {describe, expect, it} from "vitest";
import {decodeState, encodeState} from "./state.js";
const digest = "ab".repeat(32);
describe("PC-98 snapshots", () => {
  it("restores CPU bytes and changed disk blocks without modifying the base disk", () => {
    const base = new Uint8Array(150000), disk = base.slice(); disk[70000] = 7; disk[149999] = 9;
    const bytes = encodeState(digest, base, disk, new Uint8Array([1, 2, 3]));
    const restored = decodeState(bytes, digest, base);
    expect(restored.state).toEqual(new Uint8Array([1, 2, 3]));
    expect(restored.disk).toEqual(disk); expect(base.every(value => value === 0)).toBe(true);
    expect(bytes.length).toBeLessThan(disk.length);
  });
  it("rejects wrong content identity, truncated state, and trailing bytes", () => {
    const base = new Uint8Array(512), bytes = encodeState(digest, base, base, new Uint8Array([1]));
    expect(() => decodeState(bytes, "cd".repeat(32), base)).toThrow("NP2KAI_CHECKPOINT_INVALID");
    expect(() => decodeState(bytes.subarray(0, -1), digest, base)).toThrow("NP2KAI_CHECKPOINT_INVALID");
    expect(() => decodeState(new Uint8Array([...bytes, 0]), digest, base)).toThrow("NP2KAI_CHECKPOINT_INVALID");
    expect(() => encodeState(digest, base, base, new Uint8Array())).toThrow("NP2KAI_CHECKPOINT_INVALID");
  });
});
