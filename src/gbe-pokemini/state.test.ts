import {expect, it} from "vitest";
import {encodeState, decodeState, stateLimit} from "./state.js";
const identity = "a".repeat(64);
it("preserves every native snapshot byte and binds it to the game", () => {
  const state = new Uint8Array([1, 2, 255]);
  const bytes = encodeState(identity, state);
  expect(decodeState(identity, bytes)).toEqual(state);
  expect(() => decodeState("b".repeat(64), bytes)).toThrow("GBE_CHECKPOINT_INVALID");
});
it("rejects empty, corrupt, truncated and excessive snapshots", () => {
  expect(() => encodeState(identity, new Uint8Array())).toThrow();
  expect(() => encodeState(identity, new Uint8Array(stateLimit))).toThrow();
  const bytes = encodeState(identity, new Uint8Array([1, 2, 3]));
  expect(() => decodeState(identity, bytes.slice(0, -1))).toThrow();
  bytes[bytes.length - 1] ^= 1;
  expect(() => decodeState(identity, bytes)).toThrow("GBE_CHECKPOINT_INVALID");
});
