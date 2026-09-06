import {expect, it, vi} from "vitest";

import {initializeEmulatorJsGamepads} from "./startup-gamepads.js";

it("fills free players without duplicating or replacing existing gamepad assignments", () => {
  const instance = {
    gamepad: {gamepads: [{id: "Pad", index: 0}, {id: "Pad", index: 1}, {id: "Pad", index: 2}]},
    gamepadSelection: ["", "Pad_0", "", ""],
    updateGamepadLabels: vi.fn(),
  };
  initializeEmulatorJsGamepads(instance);
  expect(instance.gamepadSelection).toEqual(["Pad_1", "Pad_0", "Pad_2", ""]);
  initializeEmulatorJsGamepads(instance);
  expect(instance.updateGamepadLabels).toHaveBeenCalledOnce();
});

it("leaves full player assignments and a runtime without detected gamepads alone", () => {
  const instance = {
    gamepad: {gamepads: [{id: "Extra pad", index: 4}]},
    gamepadSelection: ["Pad_0", "Pad_1", "Pad_2", "Pad_3"],
    updateGamepadLabels: vi.fn(),
  };
  initializeEmulatorJsGamepads(instance);
  expect(instance.gamepadSelection).toEqual(["Pad_0", "Pad_1", "Pad_2", "Pad_3"]);
  expect(instance.updateGamepadLabels).not.toHaveBeenCalled();
  expect(() => initializeEmulatorJsGamepads({})).not.toThrow();
});
