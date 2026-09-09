import {describe, expect, it} from "vitest";
import {gamepadKeys} from "./input.js";

describe("OpenBOR standard gamepad", () => {
  it("maps navigation, confirm, cancel and combat without native joystick configuration", () => {
    const buttons = Array.from({length: 17}, (_, index) => ({pressed: [0, 1, 9, 14].includes(index), value: 0, touched: false}));
    expect(gamepadKeys({mapping: "standard", connected: true, buttons, axes: [0, -0.8]}))
      .toEqual(new Set([82, 80, 4, 22, 40]));
    expect(gamepadKeys(null)).toEqual(new Set());
  });
  it("maps each button to at most one input, preserving separate Start and Back controls", () => {
    for (let index = 0; index < 17; index++) {
      const buttons = Array.from({length: 17}, (_, i) => ({pressed: i === index, value: 0, touched: false}));
      const keys = gamepadKeys({mapping: "standard", connected: true, buttons, axes: [0, 0]});
      expect(keys.size).toBeLessThanOrEqual(1);
      if (index === 0) {expect(keys).toEqual(new Set([4]));}
      if (index === 1) {expect(keys).toEqual(new Set([22]));}
      if (index === 8) {expect(keys).toEqual(new Set([41]));}
      if (index === 9) {expect(keys).toEqual(new Set([40]));}
    }
  });
});
