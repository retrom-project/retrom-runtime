import {describe, expect, it} from "vitest";
import {decodeState, encodeState} from "./state.js";
const identity = "a".repeat(64);
describe("fantasy console checkpoints", () => {
  it("binds a complete native save to its core and cart", async () => {
    const payload = new Uint8Array(1024); payload[0] = 23;
    const state = await encodeState("tic80", identity, payload);
    expect(await decodeState("tic80", identity, state)).toEqual(payload);
    await expect(decodeState("fake08", identity, state)).rejects.toThrow("FANTASY_CHECKPOINT_INVALID");
    await expect(decodeState("tic80", "b".repeat(64), state)).rejects.toThrow("FANTASY_CHECKPOINT_INVALID");
    state[state.length - 1] ^= 1;
    await expect(decodeState("tic80", identity, state)).rejects.toThrow("FANTASY_CHECKPOINT_INVALID");
  });
  it("rejects empty, oversized and truncated states", async () => {
    await expect(encodeState("tic80", identity, new Uint8Array(1023))).rejects.toThrow();
    await expect(encodeState("fake08", identity, new Uint8Array())).rejects.toThrow();
    await expect(encodeState("fake08", identity, new Uint8Array(4 * 1024 * 1024 + 1))).rejects.toThrow();
    const state = await encodeState("fake08", identity, Uint8Array.of(1, 2, 3));
    await expect(decodeState("fake08", identity, state.slice(0, -1))).rejects.toThrow();
  });
});
