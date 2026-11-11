import {afterEach, expect, it, vi} from "vitest";
import {installTouchGamepad} from "./touch-gamepad.js";
import type {TouchGamepadOptions} from "./touch-gamepad-layout.js";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
  document.body.replaceChildren(); document.head.replaceChildren();
});

function install(options: TouchGamepadOptions = {}) {
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: true})});
  vi.spyOn(window, "focus").mockImplementation(() => {});
  return installTouchGamepad(window, options);
}
function root() {return document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;}
function control(name: string) {return root().querySelector<HTMLElement>(`[data-control="${name}"]`);}
/** A 100px stick resting at (left, top) whose drawn box follows the floating translate like a real layout. */
function placeStick(element: HTMLElement, left: number, top: number) {
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
    const x = parseFloat(element.style.getPropertyValue("--float-x")) || 0;
    const y = parseFloat(element.style.getPropertyValue("--float-y")) || 0;
    return {left: left + x, top: top + y, width: 100, height: 100} as DOMRect;
  });
}
function pointer(type: string, target: Element, x: number, y: number, pointerId = 1) {
  target.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerType: "touch", pointerId, clientX: x, clientY: y}));
}
function pressed(touch: ReturnType<typeof installTouchGamepad>) {
  return touch.current()?.buttons.flatMap((button, index) => button.pressed ? [index] : []) ?? [];
}

it("starts a re-press away from the stick centre without a direction and steers from the touch-down point", () => {
  const touch = install();
  try {
    const pad = control("dpad")!;
    placeStick(pad, 0, 0);
    pointer("pointerdown", pad, 85, 50);
    expect(pressed(touch)).toEqual([]);
    pointer("pointermove", pad, 85, 15);
    expect(pressed(touch)).toEqual([12]);
    pointer("pointerup", pad, 85, 15);
    expect(pressed(touch)).toEqual([]);
    expect(pad.style.getPropertyValue("--float-x")).toBe("");
    // Lifting and landing a little left of the old spot must not move the character left.
    pointer("pointerdown", pad, 20, 55);
    expect(pressed(touch)).toEqual([]);
    pointer("pointermove", pad, 60, 55);
    expect(pressed(touch)).toEqual([15]);
  } finally {touch.cleanup();}
});

it("centres the stick on a touch anywhere in the lower-left zone", () => {
  const touch = install();
  try {
    const pad = control("dpad")!, zone = control("stick-zone")!;
    placeStick(pad, 10, 500);
    expect(root().firstElementChild).toBe(zone);
    pointer("pointerdown", zone, 200, 400);
    expect(pressed(touch)).toEqual([]);
    expect(pad.style.getPropertyValue("--float-x")).toBe("140px");
    expect(pad.style.getPropertyValue("--float-y")).toBe("-150px");
    pointer("pointermove", zone, 200, 360);
    expect(pressed(touch)).toEqual([12]);
    pointer("pointercancel", zone, 200, 360);
    expect(pressed(touch)).toEqual([]);
    expect(pad.style.getPropertyValue("--float-x")).toBe("");
  } finally {touch.cleanup();}
});

it("drags the centre along past the rim so a reversal answers at once", () => {
  const touch = install();
  try {
    const pad = control("dpad")!;
    placeStick(pad, 0, 0);
    pointer("pointerdown", pad, 50, 50);
    pointer("pointermove", pad, 250, 50);
    expect(pressed(touch)).toEqual([15]);
    pointer("pointermove", pad, 170, 50);
    expect(pressed(touch)).toEqual([14]);
  } finally {touch.cleanup();}
});

it("keeps a floating analog stick neutral on touch-down", () => {
  const touch = install({layout: "JOYSTICK"});
  try {
    const analog = control("analog")!;
    placeStick(analog, 0, 0);
    pointer("pointerdown", analog, 90, 20);
    expect(touch.current()?.axes.slice(0, 2)).toEqual([0, 0]);
    pointer("pointermove", analog, 90, 70);
    expect(touch.current()?.axes[1]).toBeCloseTo(1);
    expect(touch.current()?.axes[0]).toBe(0);
  } finally {touch.cleanup();}
});

it("drives the nearest visible stick from the zone when the layout has two", () => {
  const touch = install({layout: "PSP"});
  try {
    const pad = control("dpad")!, analog = control("analog")!;
    placeStick(pad, 0, 500); placeStick(analog, 125, 500);
    pointer("pointerdown", control("stick-zone")!, 190, 520);
    expect(analog.style.getPropertyValue("--float-x")).not.toBe("");
    expect(pad.style.getPropertyValue("--float-x")).toBe("");
  } finally {touch.cleanup();}
});

it("keeps the stick-only area for fixed sticks and games that read their own touches", () => {
  for (const options of [{stickMode: "FIXED"}, {layout: "POINTER"}, {wideStickZone: false}] as const) {
    const touch = install(options);
    try {expect(control("stick-zone")).toBeNull();}
    finally {touch.cleanup();}
  }
});

it("still reads a fixed stick from its resting centre", () => {
  const touch = install({stickMode: "FIXED"});
  try {
    const pad = control("dpad")!;
    placeStick(pad, 0, 0);
    pointer("pointerdown", pad, 90, 50);
    expect(pressed(touch)).toEqual([15]);
    expect(pad.style.getPropertyValue("--float-x")).toBe("");
  } finally {touch.cleanup();}
});
