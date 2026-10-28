import {expect, vi} from "vitest";
import type {MountedRuntimeAdapter} from "../src/internal-adapter.js";
import {RuntimeGamepadFilter, installRuntimeGamepadFilter} from "../src/provider/gamepad-filter.js";
import {installTouchGamepad} from "../src/provider/touch-gamepad.js";

/** Exercise an adapter's real layout through the same merged Gamepad API used by its core. */
export function adapterTouchFixture(adapter: MountedRuntimeAdapter, fallback: Window = window) {
  const settings = adapter.touchGamepad;
  expect(settings).toBeTruthy();
  if (!settings) {throw new Error("Adapter has no virtual controls");}
  const {inputWindow = fallback, ...options} = settings === true ? {} : settings;
  const originalMedia = Object.getOwnPropertyDescriptor(inputWindow, "matchMedia");
  const originalPads = Object.getOwnPropertyDescriptor(inputWindow.navigator, "getGamepads");
  Object.defineProperty(inputWindow, "matchMedia", {configurable: true, value: () => ({matches: true})});
  Object.defineProperty(inputWindow.navigator, "getGamepads", {configurable: true, value: () => [null]});
  const focus = vi.spyOn(inputWindow, "focus").mockImplementation(() => {});
  const touch = installTouchGamepad(inputWindow, options);
  const filter = new RuntimeGamepadFilter(null);
  filter.setTouchGamepad(touch);
  const removeFilter = installRuntimeGamepadFilter(inputWindow, filter);
  const root = inputWindow.document.querySelector<HTMLElement>("[data-retrom-touch-gamepad]")!;
  return {
    touch, root, realm: inputWindow,
    press(selector: string, x = 75, y = 50) {
      const control = root.querySelector<HTMLElement>(selector)!;
      expect(control).not.toBeNull();
      vi.spyOn(control, "getBoundingClientRect").mockReturnValue({left: 0, top: 0, width: 100, height: 100} as DOMRect);
      control.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", pointerId: 1, clientX: x, clientY: y}));
    },
    release() {inputWindow.dispatchEvent(new PointerEvent("pointerup", {pointerId: 1}));},
    dispose() {
      removeFilter(); touch.cleanup(); focus.mockRestore();
      if (originalMedia) {Object.defineProperty(inputWindow, "matchMedia", originalMedia);} else {Reflect.deleteProperty(inputWindow, "matchMedia");}
      if (originalPads) {Object.defineProperty(inputWindow.navigator, "getGamepads", originalPads);} else {Reflect.deleteProperty(inputWindow.navigator, "getGamepads");}
    },
  };
}
