import {describe, expect, it} from "vitest";
import {initializeEmulatorJsGamepads} from "./startup-gamepads.js";

function pad(axes = [0, 0, 0, 0], down: number[] = [], index = 0): Gamepad {
  return {axes, buttons: Array.from({length: 17}, (_, i) => ({pressed: down.includes(i),
    touched: down.includes(i), value: down.includes(i) ? 1 : 0})), connected: true,
  id: `pad-${index}`, index, mapping: "standard", timestamp: 1} as unknown as Gamepad;
}

function fixture(core = "fceumm") {
  let source: (Gamepad | null)[] = [pad()];
  const original = () => source;
  const instance = {gamepad: {gamepads: [], getGamepads: original}, gamepadSelection: ["", "", "", ""]};
  const stop = initializeEmulatorJsGamepads(instance, core);
  const read = (pads: (Gamepad | null)[]) => {source = pads; return instance.gamepad.getGamepads();};
  return {read, stop, instance, original};
}

function directions(value: Gamepad | null) {
  return value?.buttons.flatMap((button, i) => i >= 12 && i <= 15 && button.pressed ? [i] : []) ?? [];
}

describe("physical left stick as digital directions", () => {
  it.each(["fceumm", "nestopia", "fbneo", "fbalpha", "fbalpha2012_cps1", "fbalpha2012_cps2", "mame2003", "mame2003_plus"])(
    "supports all four directions and diagonals in %s", core => {
      const {read} = fixture(core);
      expect(directions(read([pad([-1, -1])])[0])).toEqual([12, 14]);
      expect(directions(read([pad([1, 1])])[0])).toEqual([13, 15]);
      expect(directions(read([pad()])[0])).toEqual([]);
    });

  it("retains D-pad holds when the stick returns to center, and vice versa", () => {
    const {read} = fixture();
    for (const [axes, buttons] of [[[1, 0], []], [[1, 0], [15]], [[0, 0], [15]], [[1, 0], [15]], [[1, 0], []]] as const) {
      expect(directions(read([pad([...axes], [...buttons])])[0])).toEqual([15]);
    }
    expect(directions(read([pad()])[0])).toEqual([]);
  });

  it("gives the physical D-pad priority on each axis while retaining mixed diagonals", () => {
    const {read} = fixture();
    expect(directions(read([pad([1, 0], [14])])[0])).toEqual([14]);
    expect(directions(read([pad([1, 0], [12])])[0])).toEqual([12, 15]);
    expect(directions(read([pad([0, -1], [13, 14])])[0])).toEqual([13, 14]);
  });

  it("rejects drift and uses hysteresis without delaying a direct direction reversal", () => {
    const {read} = fixture();
    for (const x of [0, .1, -.2, .49]) {expect(directions(read([pad([x, 0])])[0])).toEqual([]);}
    expect(directions(read([pad([.5, 0])])[0])).toEqual([15]);
    expect(directions(read([pad([.4, 0])])[0])).toEqual([15]);
    expect(directions(read([pad([-.9, 0])])[0])).toEqual([14]);
    expect(directions(read([pad([-.35, 0])])[0])).toEqual([]);
    expect(directions(read([pad([-.4, 0])])[0])).toEqual([]);
  });

  it("keeps gamepads independent, including sparse indexes and reused controller slots", () => {
    const {read} = fixture();
    const pads = read([null, pad([1, 0], [], 1), null, pad([0, -1], [], 3)]);
    expect(directions(pads[1])).toEqual([15]);
    expect(directions(pads[3])).toEqual([12]);
    expect(directions(read([null, {...pad([.4, 0], [], 1), id: "replacement"}])[1])).toEqual([]);
  });

  it("sends a neutral sample before a disconnected pad disappears, so EJS releases held directions", () => {
    const {read} = fixture();
    read([pad([1, 0], [0], 2)]);
    const release = read([]).find(p => p?.index === 2);
    expect(release?.buttons.every(button => !button.pressed)).toBe(true);
    expect(release?.axes.every(value => value === 0)).toBe(true);
    expect(read([])).toEqual([]);
    expect(directions(read([pad([.4, 0], [], 2)])[0])).toEqual([]);
  });

  it("does not mutate browser snapshots or duplicate consumed axes into analog controls", () => {
    const {read} = fixture();
    const source = pad([.8, -.9, .6, -.7], [0, 8, 9]);
    const result = read([source])[0]!;
    expect(result.axes).toEqual([0, 0, .6, -.7]);
    expect(result.buttons.slice(0, 12)).toEqual(source.buttons.slice(0, 12));
    expect(source.axes).toEqual([.8, -.9, .6, -.7]);
    expect(source.buttons[15].pressed).toBe(false);
  });

  it("releases on neutral filtered input and invalid axes, without altering reserved buttons", () => {
    const {read} = fixture();
    read([pad([1, 1], [8, 9])]);
    expect(directions(read([pad()])[0])).toEqual([]);
    expect(directions(read([pad([NaN, Infinity])])[0])).toEqual([]);
    expect(directions(read([pad([])])[0])).toEqual([]);
  });

  it.each(["flycast", "mupen64plus_next", "parallel_n64", "pcsx_rearmed", "desmume", "ppsspp", ""])(
    "preserves native analog input for %s", core => {
      const {read, instance, original} = fixture(core);
      const source = pad([1, -1, -.7, .6], [14]);
      expect(instance.gamepad.getGamepads).toBe(original);
      expect(read([source])[0]).toBe(source);
    });

  it("leaves nonstandard mappings alone and restores the original poll method on exit", () => {
    const {read, instance, original, stop} = fixture();
    const nonstandard = {...pad([1, 0]), mapping: "" as GamepadMappingType};
    expect(read([nonstandard])[0]).toBe(nonstandard);
    read([pad([1, 0])]);
    stop(); stop();
    expect(instance.gamepad.getGamepads).toBe(original);
  });
});
