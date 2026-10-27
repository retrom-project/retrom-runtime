import {afterEach, expect, it, vi} from "vitest";
import {captureGamepadSource, installRuntimeGamepadFilter, RuntimeGamepadFilter} from "./gamepad-filter.js";
import {installTouchGamepad} from "./touch-gamepad.js";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "getGamepads");
  document.body.replaceChildren(); document.head.replaceChildren();
});
function touchDevice() {
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: true})});
  Object.defineProperty(navigator, "getGamepads", {configurable: true, value: () => [null]});
}
function pointer(type: string, target: Element, pointerId = 1, x = 0, y = 0) {
  target.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true,
    pointerType: "touch", pointerId, clientX: x, clientY: y}));
}
function root() {return document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;}

it("keeps a retained controller neutral after cleanup", async () => {
  touchDevice();
  const touch = installTouchGamepad(window);
  pointer("pointerdown", root().querySelector('[data-face="bottom"]')!);
  touch.cleanup();
  expect(touch.current()).toBeNull();
  await expect(touch.setEnabled(true)).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
});

it("applies an initial disabled preference and keeps ordinary game touches from reopening the pad", async () => {
  touchDevice();
  const touch = installTouchGamepad(window, {enabled: false});
  try {
    expect(root().hidden).toBe(true);
    pointer("pointerdown", document.body);
    expect(root().hidden).toBe(true);
    expect(touch.current()).toBeNull();
    await touch.setEnabled(true);
    expect(root().hidden).toBe(false);
    const a = root().querySelector('[data-face="bottom"]')!;
    pointer("pointerdown", a);
    expect(touch.current()?.buttons[0]?.pressed).toBe(true);
    await touch.setEnabled(false);
    await touch.setEnabled(true);
    expect(touch.current()?.buttons.every(button => !button.pressed)).toBe(true);
  } finally {touch.cleanup();}
});

it("shares a PSP layout with a proportional analog stick, shoulder and start/select controls", async () => {
  touchDevice();
  const touch = installTouchGamepad(window, {layout: "PSP"});
  try {
    const analog = root().querySelector<HTMLElement>('[data-control="analog"]')!;
    expect(analog).not.toBeNull();
    vi.spyOn(analog, "getBoundingClientRect").mockReturnValue({left: 0, top: 0, width: 100, height: 100} as DOMRect);
    pointer("pointerdown", analog, 1, 75, 50);
    expect(touch.current()?.axes[0]).toBeGreaterThan(0);
    expect(touch.current()?.axes[0]).toBeLessThan(1);
    for (const index of [4, 5, 8, 9]) {
      const button = root().querySelector(`[data-button="${index}"]`)!;
      expect(button).not.toBeNull();
      pointer("pointerdown", button, index + 2);
      expect(touch.current()?.buttons[index]?.pressed).toBe(true);
    }
    touch.setSuspended(true);
    expect(touch.current()).toBeNull();
    touch.setSuspended(false);
    expect(touch.current()?.axes).toEqual([0, 0, 0, 0]);
    expect(touch.current()?.buttons.every(button => !button.pressed)).toBe(true);
  } finally {touch.cleanup();}
});

it("delivers touch input to the cursor source without advancing the host chord filter", () => {
  touchDevice();
  const filter = new RuntimeGamepadFilter({activeGamepadIndex: 0, suppressInput: false});
  const remove = installRuntimeGamepadFilter(window, filter);
  const cursorSource = captureGamepadSource(window);
  const touch = installTouchGamepad(window);
  filter.setTouchGamepad(touch);
  try {
    pointer("pointerdown", root().querySelector('[data-face="bottom"]')!);
    expect(cursorSource()[0]?.buttons[0]?.pressed).toBe(true);
    expect(navigator.getGamepads()[0]?.buttons[0]?.pressed).toBe(true);
  } finally {touch.cleanup(); remove();}
});
