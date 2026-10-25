import {afterEach, describe, expect, it, vi} from "vitest";
import {RuntimeGamepadFilter} from "./gamepad-filter.js";
import {dpadDirections, installTouchGamepad, mergeTouchGamepad, TouchGamepadState} from "./touch-gamepad.js";

function physicalPad(values: Record<number, number> = {}) {
  return {
    axes: [0.5, 0, 0, 0], connected: true, id: "physical", index: 0, mapping: "standard" as const, timestamp: 5,
    buttons: Array.from({length: 17}, (_, index) => Object.create({
      get pressed() {return (values[index] ?? 0) >= 0.5;}, get touched() {return (values[index] ?? 0) > 0;},
      get value() {return values[index] ?? 0;},
    }) as GamepadButton),
  };
}
function pressedIndexes(gamepad: Pick<Gamepad, "buttons"> | null | undefined) {
  return gamepad?.buttons.flatMap((button, index) => button.pressed ? [index] : []) ?? [];
}
function touchFirst(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {configurable: true, value: vi.fn(() => ({matches}))});
}
function pointer(type: string, target: Element, pointerId: number, point: {x: number; y: number} = {x: 0, y: 0}) {
  target.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId, pointerType: "touch",
    clientX: point.x, clientY: point.y}));
}
function controls() {
  const root = document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;
  const pad = root.querySelector<HTMLElement>('[data-control="dpad"]')!;
  vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({left: 0, top: 100, width: 100, height: 100} as DOMRect);
  const face = (slot: string) => root.querySelector<HTMLElement>(`[data-face="${slot}"]`)!;
  return {root, pad, face};
}
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
  document.body.replaceChildren(); document.head.replaceChildren();
});

describe("touch gamepad state", () => {
  it("occupies slot 0 alone and OR-merges with a physical player 1 pad", () => {
    const state = new TouchGamepadState();
    state.set(0, true, 7);
    expect(mergeTouchGamepad([null], state.snapshot())[0]).toMatchObject({index: 0, mapping: "standard", connected: true, timestamp: 7});
    const merged = mergeTouchGamepad([physicalPad({13: 1}), physicalPad()], state.snapshot());
    expect(pressedIndexes(merged[0])).toEqual([0, 13]);
    expect(merged[0]).toMatchObject({id: "physical", axes: [0.5, 0, 0, 0], timestamp: 7});
    expect(pressedIndexes(merged[1])).toEqual([]);
    expect(mergeTouchGamepad([physicalPad({1: 1})], null)[0]?.buttons[1]?.pressed).toBe(true);
  });

  it("maps the D-pad to 8 directions outside a central dead zone", () => {
    expect(dpadDirections(5, 0, 50)).toEqual([]);
    expect(dpadDirections(40, 0, 50)).toEqual([15]);
    expect(dpadDirections(0, -40, 50)).toEqual([12]);
    expect(dpadDirections(-30, 30, 50)).toEqual([13, 14]);
    expect(dpadDirections(30, -30, 50)).toEqual([12, 15]);
  });

  it("joins before the host policy so suppression also silences the touch pad", () => {
    const filter = new RuntimeGamepadFilter({activeGamepadIndex: null, suppressInput: false});
    const touch = {current: () => {const state = new TouchGamepadState(); state.set(1, true, 1); return state.snapshot();},
      observePhysical: vi.fn(), cleanup: vi.fn()};
    filter.setTouchGamepad(touch);
    expect(pressedIndexes(filter.filter([], 1)[0])).toEqual([1]);
    expect(touch.observePhysical).toHaveBeenCalledWith([]);
    filter.setPolicy({activeGamepadIndex: null, suppressInput: true});
    expect(pressedIndexes(filter.filter([], 2)[0])).toEqual([]);
  });
});

describe("on-screen touch gamepad", () => {
  it("announces itself on touch-first devices and reports multi-touch D-pad and face input", () => {
    touchFirst(true);
    const connected = vi.fn();
    window.addEventListener("gamepadconnected", connected);
    const touch = installTouchGamepad(window);
    const {root, pad, face} = controls();
    expect(root.hidden).toBe(false);
    expect(connected).toHaveBeenCalledOnce();
    expect((connected.mock.calls[0]?.[0] as GamepadEvent).gamepad).toMatchObject({index: 0, mapping: "standard"});

    pointer("pointerdown", pad, 1, {x: 50, y: 110});
    pointer("pointerdown", face("bottom"), 2);
    expect(pressedIndexes(touch.current())).toEqual([0, 12]);
    pointer("pointermove", pad, 1, {x: 90, y: 110});
    expect(pressedIndexes(touch.current())).toEqual([0, 12, 15]);
    pointer("pointermove", pad, 1, {x: 50, y: 150});
    expect(pressedIndexes(touch.current())).toEqual([0]);
    pointer("pointerup", face("bottom"), 2);
    pointer("pointercancel", pad, 1);
    expect(pressedIndexes(touch.current())).toEqual([]);
    window.removeEventListener("gamepadconnected", connected);
    touch.cleanup();
    expect(document.querySelector("[data-retrom-touch-gamepad]")).toBeNull();
  });

  it("stays hidden for fine pointers until touched and yields to an active physical controller", () => {
    touchFirst(false);
    const touch = installTouchGamepad(window);
    const {root, face} = controls();
    expect(root.hidden).toBe(true);
    expect(touch.current()).toBeNull();
    pointer("pointerdown", document.body, 3);
    expect(root.hidden).toBe(false);
    pointer("pointerdown", face("right"), 4);
    expect(pressedIndexes(touch.current())).toEqual([1]);

    touch.observePhysical([physicalPad()]);
    expect(root.hidden).toBe(false);
    const disconnected = vi.fn();
    window.addEventListener("gamepaddisconnected", disconnected);
    touch.observePhysical([physicalPad({0: 1})]);
    expect(root.hidden).toBe(true);
    expect(touch.current()).toBeNull();
    // The physical pad owns slot 0, so the core keeps that connection.
    expect(disconnected).not.toHaveBeenCalled();
    window.removeEventListener("gamepaddisconnected", disconnected);
    touch.cleanup();
  });

  it("releases every held control when the frame loses focus", () => {
    touchFirst(true);
    const touch = installTouchGamepad(window);
    const {face} = controls();
    pointer("pointerdown", face("left"), 5);
    pointer("pointerdown", face("top"), 6);
    expect(pressedIndexes(touch.current())).toEqual([2, 3]);
    window.dispatchEvent(new Event("blur"));
    expect(pressedIndexes(touch.current())).toEqual([]);
    expect(face("left").hasAttribute("data-active")).toBe(false);
    touch.cleanup();
  });
});
