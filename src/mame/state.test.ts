// @vitest-environment node
import {expect, it} from "vitest";
import {encodeState, decodeState, checkpointLimit} from "./state.js";
const game = "a".repeat(64), build = "b".repeat(64);
it("round-trips a nonempty instantaneous native state bound to content and build", async () => {
  const native = new Uint8Array([1, 2, 3, 4]);
  const state = await encodeState(game, build, native);
  expect(await decodeState(game, build, state)).toEqual(native);
  expect(state.subarray(0, 8)).toEqual(new TextEncoder().encode("RTMAME01"));
  await expect(decodeState("c".repeat(64), build, state)).rejects.toThrow("MAME_CHECKPOINT_INVALID");
  await expect(decodeState(game, "c".repeat(64), state)).rejects.toThrow("MAME_CHECKPOINT_INVALID");
  const corrupt = state.slice(); corrupt[corrupt.length - 1] ^= 1;
  await expect(decodeState(game, build, corrupt)).rejects.toThrow("MAME_CHECKPOINT_INVALID");
  await expect(decodeState(game, build, state.subarray(0, state.length - 1))).rejects.toThrow("MAME_CHECKPOINT_INVALID");
});
it("rejects empty and oversized native states before constructing a checkpoint", async () => {
  await expect(encodeState(game, build, new Uint8Array())).rejects.toThrow("MAME_CHECKPOINT_INVALID");
  await expect(encodeState(game, build, new Uint8Array(checkpointLimit))).rejects.toThrow("MAME_CHECKPOINT_INVALID");
});
