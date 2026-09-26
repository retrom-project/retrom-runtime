import {afterEach, describe, expect, it, vi} from "vitest";
import {installGamepadCursor} from "./gamepad-cursor.js";
import {installRuntimeGamepadFilter, RuntimeGamepadFilter} from "./gamepad-filter.js";

function setup(defaultEnabled = true, protocol: "mouse" | "pointer" = "mouse", filter?: RuntimeGamepadFilter) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 50, 800, 600));
  const pad = {index: 2, connected: true, mapping: "standard" as const, id: "pad", timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}))};
  let pads: (typeof pad | null)[] = [null, pad];
  const native = () => pads;
  Object.defineProperty(navigator, "getGamepads", {configurable: true, value: native});
  const removeFilter = filter ? installRuntimeGamepadFilter(window, filter) : () => undefined;
  let callback: FrameRequestCallback = () => undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(fn => {callback = fn; return 1;});
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const events: MouseEvent[] = [];
  for (const type of ["mousemove", "mousedown", "mouseup", "click", "contextmenu"]) {
    canvas.addEventListener(type, event => events.push(event as MouseEvent));
  }
  const cursor = installGamepadCursor(window, canvas, {defaultEnabled, protocol});
  const press = (index: number, down = true) => {pad.buttons[index] = {pressed: down, touched: down, value: Number(down)};};
  return {cursor, canvas, pad, press, events, native, removeFilter, tick: (time: number) => callback(time), disconnect: () => {pads = [];}};
}

afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren(); Reflect.deleteProperty(navigator, "getGamepads");});

describe("shared gamepad cursor", () => {
  it("never advances the host's stateful chord filter while polling cursor input", () => {
    const filter = new RuntimeGamepadFilter({activeGamepadIndex: 2, suppressInput: false});
    const filtering = vi.spyOn(filter, "filter");
    const f = setup(true, "mouse", filter);
    f.tick(0); f.press(8); f.tick(16); f.press(8, false); f.tick(32);
    expect(filtering).not.toHaveBeenCalled();
    navigator.getGamepads();
    expect(filtering).toHaveBeenCalledOnce();
    f.cursor.dispose(); f.removeFilter();
    expect(navigator.getGamepads).toBe(f.native);
  });
  it("delivers pointer events and enter/leave without duplicating mouse down for pointer adapters", () => {
    const f = setup(true, "pointer");
    const events: string[] = [];
    for (const name of ["pointerenter", "pointerleave", "pointerdown", "pointerup"]) {
      f.canvas.addEventListener(name, () => events.push(name));
    }
    f.tick(0); f.press(0); f.tick(16); f.cursor.setSuspended(true);
    expect(events).toEqual(["pointerenter", "pointerdown", "pointerup", "pointerleave"]);
    expect(f.events.filter(event => event.type === "mousedown")).toHaveLength(0);
    f.cursor.dispose();
  });
  it("owns only mapped controls, preserves menu chords and other controllers, and carries drag button state", () => {
    const f = setup();
    f.tick(0); f.press(0); f.tick(16);
    f.pad.axes[0] = 1; f.press(8); f.press(9); f.tick(32);
    const game = navigator.getGamepads()[1]!;
    expect(game.axes[0]).toBe(0);
    expect(game.buttons[0].pressed).toBe(false);
    expect(game.buttons[8].pressed && game.buttons[9].pressed).toBe(true);
    expect(f.events.find(event => event.type === "mousemove")?.buttons).toBe(1);
    expect(f.events.at(-1)?.clientX).toBeGreaterThan(500);
    f.press(0, false); f.tick(48);
    expect(f.events.filter(event => event.type === "mouseup")).toHaveLength(1);
    expect(f.events.filter(event => event.type === "click")).toHaveLength(0);
    f.cursor.dispose();
    expect(navigator.getGamepads).toBe(f.native);
  });

  it("disabling releases without clicking and gates held controls before returning to native mapping", () => {
    const f = setup(); f.tick(0); f.press(0); f.tick(16);
    f.cursor.setEnabled(false);
    expect(f.events.map(event => event.type)).toEqual(["mousedown", "mouseup"]);
    expect(navigator.getGamepads()[1]?.buttons[0].pressed).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-gamepad-cursor]")?.hidden).toBe(true);
    f.press(0, false); f.tick(32); f.press(0); f.tick(48);
    expect(navigator.getGamepads()[1]?.buttons[0].pressed).toBe(true);
    expect(f.events).toHaveLength(2); f.cursor.dispose();
  });

  it("suspension, input suppression and disconnect release without activation, then require neutral input", () => {
    const f = setup(); f.tick(0); f.press(0); f.tick(16);
    f.cursor.setInputPolicy({activeGamepadIndex: 2, suppressInput: true});
    f.tick(32);
    f.cursor.setInputPolicy({activeGamepadIndex: 2, suppressInput: false});
    f.tick(48);
    expect(f.events.map(event => event.type)).toEqual(["mousedown", "mouseup"]);
    f.press(0, false); f.tick(64); f.press(1); f.tick(80);
    f.cursor.setSuspended(true); f.cursor.setSuspended(false); f.tick(96);
    expect(f.events.filter(event => event.type === "contextmenu")).toHaveLength(0);
    f.press(1, false); f.tick(112); f.press(0); f.tick(128); f.disconnect(); f.tick(144);
    expect(f.events.filter(event => event.type === "mouseup")).toHaveLength(3);
    f.cursor.dispose();
  });

  it("uses the claimed controller and waits for neutral when enabled while a button is held", () => {
    const f = setup(false); f.press(0); f.cursor.setEnabled(true); f.tick(0);
    expect(f.events).toHaveLength(0);
    f.press(0, false); f.tick(16); f.press(0); f.tick(32); f.press(0, false); f.tick(48);
    expect(f.events.map(event => event.type)).toEqual(["mousedown", "mouseup", "click"]);
    f.cursor.setInputPolicy({activeGamepadIndex: 7, suppressInput: false});
    f.press(0); f.tick(64);
    expect(f.events).toHaveLength(3);
    expect(navigator.getGamepads()[1]?.buttons[0].pressed).toBe(true);
    f.cursor.dispose();
  });
});
