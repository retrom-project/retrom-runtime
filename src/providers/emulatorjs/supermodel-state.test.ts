import {expect, it, vi} from "vitest";

import {installSupermodelState} from "./supermodel-state.js";

it("reads the pinned RetroArch serializer for the 4.3 frontend", () => {
  const original = vi.fn(() => Uint8Array.of(9));
  const manager = {Module: {HEAPU8: Uint8Array.of(0, 1, 2, 3),
    cwrap: vi.fn(() => () => "2|1|1")}, getState: original};
  const cleanup = installSupermodelState(manager);
  expect(manager.getState()).toEqual(Uint8Array.of(1, 2));
  cleanup();
  expect(manager.getState).toBe(original);
});

it("rejects a native result outside the current WASM heap", () => {
  const manager = {Module: {HEAPU8: Uint8Array.of(1), cwrap: () => () => "2|0|1"},
    getState: () => Uint8Array.of(1)};
  installSupermodelState(manager);
  expect(() => manager.getState()).toThrow("PLAYER_SAVE_STATE_INVALID");
});
