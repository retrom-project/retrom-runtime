import {afterEach, expect, it, vi} from "vitest";
import type {EjsWindow} from "./emulator-instance.js";
import {floatingDirections, installFloatingStick} from "./floating-stick.js";

const ejs = window as unknown as EjsWindow;
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "EJS_emulator");
  Reflect.deleteProperty(window, "EJS_VirtualGamepadSettings");
  document.body.replaceChildren();
});

/** EmulatorJS virtual gamepad with one left control resting at (left, top), 100px wide. */
function gamepad(id: string, left = 0, top = 0) {
  const send = vi.fn();
  Object.assign(window, {EJS_emulator: {gameManager: {simulateInput: send}}});
  const parent = document.createElement("div"); parent.className = "ejs_virtualGamepad_parent";
  const side = document.createElement("div"); side.className = "ejs_virtualGamepad_left";
  const control = document.createElement("div"); control.className = `b_${id}`;
  const surface = document.createElement("div"); surface.className = id === "stick" ? "nipple" : "ejs_dpad_main";
  const native = vi.fn();
  surface.addEventListener("touchstart", native);
  control.append(surface); side.append(control); parent.append(side); document.body.append(parent);
  // A D-pad draws on its pad, a nipplejs zone on itself; that element is measured and floated.
  const drawn = id === "stick" ? control : surface;
  vi.spyOn(drawn, "getBoundingClientRect").mockImplementation(() => {
    const x = parseFloat(drawn.style.getPropertyValue("--retrom-float-x")) || 0;
    const y = parseFloat(drawn.style.getPropertyValue("--retrom-float-y")) || 0;
    return {left: left + x, top: top + y, width: 100, height: 100} as DOMRect;
  });
  return {send, parent, side, control: drawn, surface, native};
}
function pointer(type: string, target: Element, x: number, y: number, pointerType = "touch") {
  target.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerType, pointerId: 1, clientX: x, clientY: y}));
}

it("maps travel to eight directions outside a quarter-radius dead zone", () => {
  expect(floatingDirections(5, 0, 50)).toEqual([false, false, false, false]);
  expect(floatingDirections(30, 0, 50)).toEqual([false, false, false, true]);
  expect(floatingDirections(0, -30, 50)).toEqual([true, false, false, false]);
  expect(floatingDirections(-30, 30, 50)).toEqual([false, true, true, false]);
});

it("starts an off-centre D-pad press neutral and keeps EmulatorJS's own handler out", () => {
  const {send, surface, control, native} = gamepad("dpad");
  const stick = installFloatingStick(ejs, {wideZone: true});
  try {
    pointer("pointerdown", surface, 90, 50);
    const touch = new Event("touchstart", {bubbles: true, cancelable: true});
    Object.defineProperty(touch, "changedTouches", {value: [{target: surface}]});
    surface.dispatchEvent(touch);
    expect(native).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(control.style.getPropertyValue("translate")).toBe("40px 0px");
    pointer("pointermove", surface, 90, 15);
    expect(send).toHaveBeenCalledWith(0, 4, 1);
    pointer("pointerup", surface, 90, 15);
    expect(send).toHaveBeenLastCalledWith(0, 4, 0);
    expect(control.style.getPropertyValue("translate")).toBe("");
  } finally {stick.dispose();}
});

it("floats the stick to a touch in the lower-left zone beneath the buttons", () => {
  const {send, parent, control} = gamepad("dpad", 10, 500);
  const stick = installFloatingStick(ejs, {wideZone: true});
  try {
    const zone = parent.firstElementChild!;
    expect(zone.className).toBe("retrom-floating-stick-zone");
    pointer("pointerdown", zone, 200, 400);
    expect(send).not.toHaveBeenCalled();
    expect(control.style.getPropertyValue("translate")).toBe("140px -150px");
    pointer("pointermove", zone, 240, 400);
    expect(send).toHaveBeenCalledWith(0, 7, 1);
  } finally {stick.dispose();}
  expect(parent.querySelector(".retrom-floating-stick-zone")).toBeNull();
});

it("treats the empty left pad area around the drawn stick as part of the stick", () => {
  const {send, side, control} = gamepad("dpad", 10, 200);
  const stick = installFloatingStick(ejs, {wideZone: false});
  try {
    pointer("pointerdown", side, 30, 220);
    expect(send).not.toHaveBeenCalled();
    expect(control.style.getPropertyValue("translate")).toBe("-30px -30px");
    pointer("pointermove", side, 30, 260);
    expect(send).toHaveBeenCalledWith(0, 5, 1);
  } finally {stick.dispose();}
});

it("drives an analog stick zone with proportional axes from the touch-down point", () => {
  const {send, surface} = gamepad("stick");
  const stick = installFloatingStick(ejs, {wideZone: false});
  try {
    pointer("pointerdown", surface, 20, 20);
    expect(send).not.toHaveBeenCalled();
    pointer("pointermove", surface, 45, 20);
    expect(send).toHaveBeenCalledWith(0, 16, 0x7fff * .5);
    expect(send).toHaveBeenCalledWith(0, 17, 0);
    pointer("pointercancel", surface, 45, 20);
    for (const input of [16, 17, 18, 19]) {expect(send).toHaveBeenCalledWith(0, input, 0);}
  } finally {stick.dispose();}
});

it("leaves mouse input, unknown controls and touch-screen cores' screens alone", () => {
  const {send, parent, surface} = gamepad("dpad");
  const stick = installFloatingStick(ejs, {wideZone: false});
  try {
    expect(parent.querySelector(".retrom-floating-stick-zone")).toBeNull();
    pointer("pointerdown", surface, 90, 50, "mouse");
    pointer("pointermove", surface, 90, 10, "mouse");
    expect(send).not.toHaveBeenCalled();
  } finally {stick.dispose();}
});

it("follows a configured layout and ignores ids it does not declare", () => {
  Object.assign(window, {EJS_VirtualGamepadSettings: [{type: "dpad", id: "dpad", location: "left", inputValues: [4, 5, 6, 7], joystickInput: true}]});
  const {send, surface} = gamepad("dpad");
  const stick = installFloatingStick(ejs, {wideZone: false});
  try {
    pointer("pointerdown", surface, 50, 50);
    pointer("pointermove", surface, 50, 90);
    // An analog-valued D-pad keeps its up/down/left/right slots and presses at full scale.
    expect(send).toHaveBeenCalledWith(0, 5, 0x7fff);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {stick.dispose();}
});
