import {afterEach, expect, it, vi} from "vitest";
import {createIsolatedInputFilter} from "./isolated-input.js";

afterEach(() => {
  vi.restoreAllMocks(); Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "getGamepads");
  document.body.replaceChildren(); document.head.replaceChildren();
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
