import {expect, it} from "vitest";
import {keyCode, padMask} from "./input.js";
it("maps standard directions, native A/B buttons and analog deadzone", () => {
  const pad: Gamepad = {id: "test", index: 0, timestamp: 0, vibrationActuator: {playEffect: async () => "complete", reset: async () => "complete"}, connected: true, mapping: "standard", buttons: Array.from({length: 16}, (_, i) => ({pressed: i === 0 || i === 1 || i === 15, touched: false, value: 0})), axes: [0, -.8]};
  expect(padMask(pad)).toBe((1 << 8) | 1 | (1 << 7) | (1 << 4));
  expect(padMask(null)).toBe(0);
  expect(keyCode({code: "Escape", key: "Escape"})).toBe(27);
  expect(keyCode({code: "F12", key: "F12"})).toBe(293);
});
it("sends one native TRIG1/TRIG2 for separate standard bottom/right presses", () => {
  for (const [physical, native] of [[0, 0], [1, 8]]) {
    const pad: Gamepad = {id: "test", index: 0, timestamp: 0, vibrationActuator: {playEffect: async () => "complete", reset: async () => "complete"}, connected: true, mapping: "standard", axes: [], buttons: Array.from({length: 17}, (_, i) => ({pressed: i === physical, touched: false, value: i === physical ? 1 : 0}))};
    expect(padMask(pad)).toBe(1 << native);
    expect(padMask({...pad, buttons: []})).toBe(0);
  }
});
