import {afterEach, describe, expect, it, vi} from "vitest";
import {installRuntimeGamepadFilter, RuntimeGamepadFilter} from "./gamepad-filter.js";

function button(value: number): GamepadButton {
  // WebIDL exposes these attributes as prototype getters, not own properties.
  return Object.create({
    get pressed() {return value >= 0.5;},
    get touched() {return value > 0;},
    get value() {return value;},
  });
}
function pad(index = 0, values: Record<number, number> = {}) {
  return {
    axes: [0.25, -0.75, 0, 1], buttons: Array.from({length: 17}, (_, i) => button(values[i] ?? 0)),
    connected: true, id: "standard controller", index, mapping: "standard" as const, timestamp: 10,
  };
}
function filter(index: number | null = 0) {
  return new RuntimeGamepadFilter({activeGamepadIndex: index, suppressInput: false});
}
function values(gamepad: Pick<Gamepad, "buttons"> | null | undefined) {
  return gamepad?.buttons.map(({pressed, touched, value}) => ({pressed, touched, value}));
}
afterEach(() => {vi.restoreAllMocks(); Reflect.deleteProperty(navigator, "getGamepads");});

describe("RuntimeGamepadFilter shared Provider input", () => {
  it("preserves native getter-backed buttons, analog values and releases on the active controller", () => {
    const runtimeFilter = filter();
    for (const buttonIndex of [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16]) {
      for (const value of [1, 0.25, 0]) {
        const source = pad(0, {[buttonIndex]: value});
        expect(Object.keys(source.buttons[buttonIndex] ?? {})).toEqual([]);
        const result = runtimeFilter.filter([source], 10)[0];
        expect(values(result)).toEqual(values(source));
        expect(result?.axes).toEqual(source.axes);
        expect(result?.axes).not.toBe(source.axes);
        expect(result?.buttons).not.toBe(source.buttons);
        expect(result).toMatchObject({id: source.id, connected: true, mapping: "standard", index: 0, timestamp: 10});
      }
    }
  });

  it("uses Gamepad.index instead of array position and leaves inactive/missing controllers unchanged", () => {
    const active = pad(4, {0: 1});
    const inactive = pad(2, {1: 1});
    const result = filter(4).filter([null, inactive, active], 0);
    expect(result[0]).toBeNull();
    expect(result[1]).toBe(inactive);
    expect(values(result[2])).toEqual(values(active));
    expect(filter(null).filter([active], 0)[0]).toBe(active);
    expect(filter(9).filter([active], 0)[0]).toBe(active);
  });

  it("suppresses all controllers and rearms held buttons after a menu policy change", () => {
    const runtimeFilter = filter();
    runtimeFilter.setPolicy({activeGamepadIndex: 0, suppressInput: true});
    const result = runtimeFilter.filter([pad(0, {0: 1}), null, pad(1, {1: 1})], 0);
    for (const gamepad of result.filter((item) => item !== null)) {
      expect(gamepad.axes).toEqual([0, 0, 0, 0]);
      expect(values(gamepad)).toEqual(Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0})));
    }
    expect(result[1]).toBeNull();
    runtimeFilter.setPolicy({activeGamepadIndex: 0, suppressInput: false});
    expect(runtimeFilter.filter([pad(0, {0: 1})], 16)[0]?.buttons[0]?.value).toBe(1);
  });

  it("reserves double Select+Start chords without dropping other buttons or single taps", () => {
    const runtimeFilter = filter();
    const sample = (time: number, pressed: Record<number, number>) => runtimeFilter.filter([pad(0, pressed)], time)[0];
    expect(sample(0, {8: 1, 0: 1})?.buttons[0]?.value).toBe(1);
    expect(sample(20, {8: 1, 9: 1})?.buttons[8]?.value).toBe(0);
    sample(40, {});
    sample(120, {8: 1});
    const chord = sample(140, {8: 1, 9: 1, 0: 1});
    expect(chord?.buttons.every((item) => item.value === 0)).toBe(true);
    sample(160, {});
    expect(sample(180, {9: 1})?.buttons[9]?.value).toBe(0);
    expect(sample(200, {})?.buttons[9]?.value).toBe(0.5);
    expect(sample(220, {})?.buttons[9]?.value).toBe(0);
    sample(240, {8: 1});
    expect(sample(350, {8: 1})?.buttons[8]?.value).toBe(1);
  });

  it("installs on the runtime navigator, preserves native receiver and restores its descriptor", () => {
    const source = pad(0, {0: 1, 1: 0.75});
    const native = vi.fn(function (this: Navigator) {expect(this).toBe(navigator); return [source];});
    Object.defineProperty(navigator, "getGamepads", {configurable: true, value: native});
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
    const cleanup = installRuntimeGamepadFilter(window, filter());
    expect(values(navigator.getGamepads()[0])).toEqual(values(source));
    cleanup();
    expect(Object.getOwnPropertyDescriptor(navigator, "getGamepads")).toEqual(descriptor);
  });
});
