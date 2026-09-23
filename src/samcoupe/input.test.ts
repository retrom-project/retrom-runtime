import {expect, it} from "vitest";
import {samGamepadKeys} from "./input.js";

it("maps standard directions and one confirm key per button", () => {
  const buttons = Array.from({length: 16}, (_, index) => ({pressed: index === 0 || index === 14, value: index === 0 || index === 14 ? 1 : 0}));
  const pad = {connected: true, mapping: "standard", axes: [0, -0.7], buttons} as unknown as Gamepad;
  expect(samGamepadKeys(pad)).toEqual(new Set(["ArrowUp", "ArrowLeft", "Enter"]));
  expect(samGamepadKeys({...pad, mapping: ""})).toEqual(new Set());
});
