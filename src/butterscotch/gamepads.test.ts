import {describe, expect, it} from "vitest";
import {RuntimeGamepadFilter} from "../provider/gamepad-filter.js";
import {readButterscotchGamepads} from "./gamepads.js";

function pad(index: number, axes = [0, 0, 0, 0], values: Record<number, number> = {}) {
  return {index, id: `pad ${index}`, connected: true, mapping: "standard" as const, axes, timestamp: 0,
    buttons: Array.from({length: 17}, (_, button) => {
      const value = values[button] ?? 0;
      return {value, pressed: value >= 0.5, touched: value > 0};
    })};
}

describe("Butterscotch shared single-player gamepad", () => {
  it("uses either device in virtual slot zero regardless of discovery order", () => {
    const second = pad(1, [1, 0, 0, 0], {0: 1});
    const fromSecond = readButterscotchGamepads([null, second]);
    expect(fromSecond).toHaveLength(1);
    expect(fromSecond[0]?.axes[0]).toBe(1);
    expect(fromSecond[0]?.buttons[0]).toBe(1);
    expect(readButterscotchGamepads([pad(0), second])).toEqual(fromSecond);
    expect(readButterscotchGamepads([pad(0, [1, 0, 0, 0], {0: 1}), pad(1)])).toEqual(fromSecond);
  });

  it("holds each button until every contributing device releases or disconnects", () => {
    const first = pad(0, undefined, {0: 1, 6: 0.3});
    const second = pad(1, undefined, {0: 1, 1: 1, 6: 0.8});
    expect(readButterscotchGamepads([first, second])[0]?.buttons.slice(0, 2)).toEqual([1, 1]);
    expect(readButterscotchGamepads([first, second])[0]?.buttons[6]).toBe(0.8);
    expect(readButterscotchGamepads([null, second])[0]?.buttons[0]).toBe(1);
    expect(readButterscotchGamepads([first, {...second, connected: false}])[0]?.buttons.slice(0, 2)).toEqual([1, 0]);
    expect(readButterscotchGamepads([pad(0), pad(1)])[0]?.buttons).toEqual(Array(17).fill(0));
    expect(readButterscotchGamepads([null, null])).toEqual([]);
  });

  it("does not amplify aligned axes and cancels opposing axes and D-pad directions", () => {
    const first = pad(0, [0.8, -1, 0.25, 0], {12: 1, 14: 1});
    const same = pad(1, [0.5, -0.5, 0, 0.75], {12: 1, 14: 1});
    expect(readButterscotchGamepads([first, same])[0]?.axes).toEqual([0.8, -1, 0.25, 0.75]);
    expect(readButterscotchGamepads([first, same])[0]?.buttons.slice(12, 16)).toEqual([1, 0, 1, 0]);
    const opposite = pad(1, [-0.8, 1, -0.25, 0], {13: 1, 15: 1});
    expect(readButterscotchGamepads([first, opposite])[0]?.axes).toEqual([0, 0, 0, 0]);
    expect(readButterscotchGamepads([first, opposite])[0]?.buttons.slice(12, 16)).toEqual([0, 0, 0, 0]);
    expect(readButterscotchGamepads([first, opposite])).toEqual(readButterscotchGamepads([opposite, first]));
  });

  it("ignores unsupported and disconnected devices and retains distinct slots when requested", () => {
    const supported = pad(1, [0.5, 0, 0, 0], {0: 1});
    const unsupported = {...pad(0, [-1, 0, 0, 0], {1: 1}), mapping: "" as const};
    const disconnected = {...pad(2, [-1, 0, 0, 0], {1: 1}), connected: false};
    expect(readButterscotchGamepads([unsupported, supported, disconnected])).toEqual(readButterscotchGamepads([supported]));
    expect(readButterscotchGamepads([unsupported, supported, disconnected], "independent")).toEqual([
      null, {axes: supported.axes, buttons: supported.buttons.map(button => button.value)}, null,
    ]);
  });

  it("combines only input allowed through the host menu filter", () => {
    const devices = [pad(0, [1, 0, 0, 0], {0: 1, 9: 1}), pad(1, [0, 1, 0, 0], {1: 1})];
    const filter = new RuntimeGamepadFilter({activeGamepadIndex: 0, suppressInput: false});
    const frame = readButterscotchGamepads(filter.filter(devices, 0))[0];
    expect(frame?.buttons.slice(0, 2)).toEqual([1, 1]);
    expect(frame?.buttons[9]).toBe(0);
    filter.setPolicy({activeGamepadIndex: 1, suppressInput: true});
    expect(readButterscotchGamepads(filter.filter(devices, 20))).toEqual([
      {axes: [0, 0, 0, 0], buttons: Array(17).fill(0)},
    ]);
  });
});
