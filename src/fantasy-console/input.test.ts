import {describe, expect, it} from "vitest";
import {controlMask} from "./input.js";
function pad(pressed: number[], axes = [0, 0]): Gamepad {
  return {mapping: "standard", connected: true, axes, id: "test-pad", index: 0, timestamp: 0,
    vibrationActuator: {playEffect: async () => "complete", reset: async () => "complete"},
    buttons: Array.from({length: 17}, (_, i) => ({pressed: pressed.includes(i), touched: false, value: pressed.includes(i) ? 1 : 0})),
  };
}
describe("fantasy console standard controls", () => {
  it("maps movement, confirm and cancel without requiring reconnect", () => {
    expect(controlMask("tic80", new Set(), [pad([15, 0, 1])])).toBe(8 | 16 | 32);
    expect(controlMask("fake08", new Set(), [pad([15, 0, 1])])).toBe(128 | 1 | 256);
    expect(controlMask("tic80", new Set(["ArrowLeft", "KeyZ"]), [])).toBe(4 | 16);
  });
  it("releases disconnected controls and respects neutral and filtered inputs", () => {
    expect(controlMask("fake08", new Set(), [null])).toBe(0);
    expect(controlMask("tic80", new Set(), [pad([], [.7, -.7])])).toBe(8 | 1);
    expect(controlMask("tic80", new Set(), [pad([], [.1, -.1])])).toBe(0);
  });
});
