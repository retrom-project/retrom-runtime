import {expect, it, vi} from "vitest";
import {MameInput, keyboardKey, padState} from "./input.js";
function pad(buttons: number[] = [], axes = [0, 0]): Gamepad {
  return {id: "test", index: 0, mapping: "standard", connected: true, timestamp: 0, axes,
    buttons: Array.from({length: 16}, (_, i) => ({pressed: buttons.includes(i), touched: buttons.includes(i), value: buttons.includes(i) ? 1 : 0})),
    vibrationActuator: {playEffect: async () => "complete", reset: async () => "complete"}};
}
it("maps directions to analog paddles and each face/menu button to a single native input", () => {
  expect(padState([pad([14, 12, 0, 9])])).toEqual({axes: [-32767, -32767], buttons: [0], keys: [49]});
  for (const button of [0, 1, 2, 3, 8, 9]) {
    const input = padState([pad([button])]); expect(input.buttons.length + input.keys.length).toBe(1);
  }
  expect(padState([pad([], [.1, -.8])]).axes).toEqual([0, -26214]);
  expect(padState([{...pad([0]), mapping: ""}])).toEqual({axes: [0, 0], buttons: [], keys: []});
});
it("keeps keyboard and gamepad ownership independent, releases held inputs on clear", () => {
  const core = {_retrom_mame_key: vi.fn(), _retrom_mame_button: vi.fn(), _retrom_mame_axis: vi.fn()};
  const input = new MameInput(core);
  input.keyboard.add(49); input.poll([pad([9, 0, 15])]); input.poll([]);
  expect(core._retrom_mame_key.mock.calls).toEqual([[49, 1]]);
  expect(core._retrom_mame_button.mock.calls).toEqual([[0, 1], [0, 0]]);
  input.clear(); expect(core._retrom_mame_key).toHaveBeenLastCalledWith(49, 0);
  expect(core._retrom_mame_axis).toHaveBeenLastCalledWith(1, 0);
});
it("translates physical keyboard keys independently of the controller layout", () => {
  expect(keyboardKey("KeyA")).toBe(97); expect(keyboardKey("Digit1")).toBe(49);
  expect(keyboardKey("Enter")).toBe(13); expect(keyboardKey("ArrowLeft")).toBe(276);
  expect(keyboardKey("Numpad1")).toBe(257);
  expect(keyboardKey("Unknown")).toBeNull();
});
it("maps Atom directions and action to separate keyboard keys without joystick input", () => {
  expect(padState([pad([14, 12, 0])], "atom")).toEqual({axes: [0, 0], buttons: [], keys: [32, 59, 122]});
  expect(padState([pad([], [.8, .8])], "atom")).toEqual({axes: [0, 0], buttons: [], keys: [46, 120]});
});
it.each([[4, 304], [5, 305]])("maps Atom auxiliary button %i to its single modifier key %i and releases it", (button, key) => {
  const core = {_retrom_mame_key: vi.fn(), _retrom_mame_button: vi.fn(), _retrom_mame_axis: vi.fn()};
  const input = new MameInput(core, "atom");
  input.poll([pad([button])]); input.poll([]);
  expect(core._retrom_mame_key.mock.calls).toEqual([[key, 1], [key, 0]]);
  expect(core._retrom_mame_button).not.toHaveBeenCalled();
  expect(core._retrom_mame_axis).toHaveBeenLastCalledWith(1, 0);
});
it("maps PV-1000 directions, fire and start to native digital controls only", () => {
  expect(padState([pad([15, 0, 9])], "pv1000")).toEqual({axes: [0, 0], buttons: [0, 3, 7], keys: []});
  const core = {_retrom_mame_key: vi.fn(), _retrom_mame_button: vi.fn(), _retrom_mame_axis: vi.fn()};
  const input = new MameInput(core, "pv1000"); input.poll([pad([15, 0])]); input.clear();
  expect(core._retrom_mame_button.mock.calls).toEqual([[0, 1], [7, 1], [0, 0], [7, 0]]);
});
it("maps six Arcade actions plus coin and start to distinct native buttons", () => {
  expect(padState([pad([0, 1, 2, 3, 4, 5, 8, 9, 12, 15])], "mspacman", true)).toEqual({
    axes: [0, 0], keys: [], buttons: [0, 1, 2, 3, 4, 7, 8, 9, 10, 11],
  });
});
it("maps SG-1000 to working keyboard directions, two fire keys and hardware pause without duplicate joystick input", () => {
  expect(padState([pad([0, 1, 9, 15])], "sg1000")).toEqual({axes: [0, 0], buttons: [], keys: [49, 275, 306, 308]});
  expect(padState([pad([], [-.8, -.8])], "sg1000")).toEqual({axes: [0, 0], buttons: [], keys: [273, 276]});
  const core = {_retrom_mame_key: vi.fn(), _retrom_mame_button: vi.fn(), _retrom_mame_axis: vi.fn()};
  const input = new MameInput(core, "sg1000");
  input.poll([pad([15, 0])]); input.poll([]);
  expect(core._retrom_mame_key.mock.calls).toEqual([[275, 1], [306, 1], [275, 0], [306, 0]]);
  expect(core._retrom_mame_button).not.toHaveBeenCalled();
});
it("keeps IIe analog controls and maps Coleco keypad start separately from fire", () => {
  expect(padState([pad([0, 9, 15])], "apple2e")).toEqual({axes: [32767, 0], buttons: [0], keys: [49]});
  expect(padState([pad([0, 9, 15])], "coleco")).toEqual({axes: [0, 0], buttons: [0, 7], keys: [257]});
});
