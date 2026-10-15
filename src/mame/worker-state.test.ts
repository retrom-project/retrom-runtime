// @vitest-environment node
import {expect, it} from "vitest";
import {zipSync} from "fflate";
import {decodeWorkerState, encodeWorkerState} from "./worker-state.js";
it("preserves native state and writable disk changes for a new core instance", () => {
  const state = {native: Uint8Array.of(1, 2), files: [{path: "diff/disk.dif", bytes: Uint8Array.of(4, 5)},
    {path: "nvram/game/eeprom", bytes: Uint8Array.of(6)}]};
  expect(decodeWorkerState(encodeWorkerState(state))).toEqual(state);
});
it("rejects missing native state, traversal, compressed input and excess state bytes", () => {
  expect(() => decodeWorkerState(zipSync({"diff/disk.dif": Uint8Array.of(1)}, {level: 0}))).toThrow("MAME_CHECKPOINT_INVALID");
  expect(() => decodeWorkerState(zipSync({"native.bin": Uint8Array.of(1), "diff/../outside": Uint8Array.of(1)}, {level: 0})))
    .toThrow("MAME_CHECKPOINT_INVALID");
  expect(() => decodeWorkerState(zipSync({"native.bin": new Uint8Array(1024)}, {level: 9}))).toThrow("MAME_CHECKPOINT_INVALID");
  expect(() => encodeWorkerState({native: Uint8Array.of(1), files: [{path: "diff/a", bytes: new Uint8Array(64 * 1024 * 1024)}]}))
    .toThrow("MAME_CHECKPOINT_INVALID");
});
