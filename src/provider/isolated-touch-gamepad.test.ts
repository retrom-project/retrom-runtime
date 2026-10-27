import {afterEach, expect, it, vi} from "vitest";
import {createIsolatedInputFilter} from "./isolated-input.js";
import {touchGamepadProfiles} from "./touch-gamepad-layout.js";
import {TouchGamepadState} from "./touch-gamepad.js";

afterEach(() => {
  vi.restoreAllMocks(); Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "getGamepads");
  Reflect.deleteProperty(document, "elementFromPoint");
  Reflect.deleteProperty(document, "elementsFromPoint");
  document.body.replaceChildren(); document.head.replaceChildren();
});

it.each(["click", "tap"] as const)("can %s DOM buttons using only virtual input while preserving the physical pad's native mapping", async activationEvent => {
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: true})});
  vi.spyOn(window, "focus").mockImplementation(() => {});
  const physical = new TouchGamepadState(); physical.set(0, true, 0);
  Object.defineProperty(navigator, "getGamepads", {configurable: true, value: () => [null, null, {...physical.snapshot(), index: 2}]});
  let frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {frames.push(callback); return 1;});
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const tick = (time: number) => {const ready = frames; frames = []; ready.forEach(callback => callback(time));};
  const target = document.createElement("div"), button = document.createElement("button");
  target.append(button); document.body.append(target);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
  Object.defineProperty(document, "elementFromPoint", {configurable: true, value: () => document.querySelector('[data-face="bottom"]')});
  Object.defineProperty(document, "elementsFromPoint", {configurable: true, value: () => [document.querySelector('[data-face="bottom"]'), button, target]});
  const click = vi.fn(), duplicate = vi.fn(), keys = vi.fn();
  button.addEventListener(activationEvent, click);
  button.addEventListener(activationEvent === "tap" ? "click" : "tap", duplicate);
  target.addEventListener("keydown", keys);
  const input = createIsolatedInputFilter(window);
  try {
    input.set({activeGamepadIndex: null, suppressInput: true});
    await input.setTouchGamepadEnabled(true, {...touchGamepadProfiles.analogMenu, pointerTarget: target, activationEvent});
    const root = document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;
    expect(root.dataset.layout).toBe("JOYSTICK");
    expect(root.hidden).toBe(true);
    input.set(null); expect(root.hidden).toBe(false);
    expect(document.querySelector("[data-gamepad-cursor]")).not.toBeNull();
    tick(0);
    const a = root.querySelector('[data-face="bottom"]')!;
    const press = (type: string) => a.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerType: "touch", pointerId: 1}));
    press("pointerdown"); tick(16);
    expect(navigator.getGamepads()[0]).toBeNull();
    expect(navigator.getGamepads()[2]?.buttons[0].pressed).toBe(true);
    press("pointerup"); tick(32);
    expect(click).toHaveBeenCalledOnce(); expect(duplicate).not.toHaveBeenCalled(); expect(keys).not.toHaveBeenCalled();
    input.set({activeGamepadIndex: null, suppressInput: true});
    expect(root.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-gamepad-cursor]")!.hidden).toBe(true);
    input.set(null); tick(40);
    press("pointerdown"); tick(48);
    await input.setTouchGamepadEnabled(false);
    expect(root.hidden).toBe(true); expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLElement>("[data-gamepad-cursor]")!.hidden).toBe(true);
  } finally {input.stop();}
  expect(document.querySelector("[data-gamepad-cursor]")).toBeNull();
});

it("runs the shared pad in the isolated realm, releases on pause/hide and cleans up its input bridge", async () => {
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: true})});
  const physical = vi.fn(() => [null]);
  Object.defineProperty(navigator, "getGamepads", {configurable: true, value: physical});
  const input = createIsolatedInputFilter(window);
  try {
    await input.setTouchGamepadEnabled(false);
    const root = document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;
    expect(root.hidden).toBe(true);
    await input.setTouchGamepadEnabled(true);
    const press = () => root.querySelector('[data-face="bottom"]')!.dispatchEvent(new PointerEvent("pointerdown",
      {bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1}));
    press(); expect(navigator.getGamepads()[0]?.buttons[0]?.pressed).toBe(true);
    input.setPaused(true); expect(root.hidden).toBe(true);
    input.setPaused(false); expect(navigator.getGamepads()[0]?.buttons[0]?.pressed).toBe(false);
    press();
    input.set({activeGamepadIndex: null, suppressInput: true});
    expect(root.hidden).toBe(true);
    input.set({activeGamepadIndex: null, suppressInput: false});
    expect(navigator.getGamepads()[0]?.buttons[0]?.pressed).toBe(false);
    await input.setTouchGamepadEnabled(false);
    document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch"}));
    expect(root.hidden).toBe(true);
  } finally {input.stop();}
  expect(navigator.getGamepads).toBe(physical);
  expect(document.querySelector("[data-retrom-touch-gamepad]")).toBeNull();
});
