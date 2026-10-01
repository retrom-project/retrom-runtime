import {afterEach, expect, it, vi} from "vitest";
import {createEmulatorJsSurface} from "./surface.js";

let cleanup = () => {};
afterEach(() => {cleanup(); document.body.replaceChildren(); vi.restoreAllMocks();});

function surface() {
  cleanup = createEmulatorJsSurface(window);
  const pad = document.createElement("div");
  pad.className = "ejs_dpad_main";
  document.body.append(pad);
  vi.spyOn(pad, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 40, 100, 100));
  return pad;
}

function touch(pad: HTMLElement, type: string, points: Array<{identifier: number; clientX: number; clientY: number}>) {
  const event = new Event(type, {bubbles: true, cancelable: true});
  Object.defineProperty(event, "targetTouches", {value: points});
  pad.dispatchEvent(event);
  return event;
}

it("moves the circular thumb with the original direction touch without consuming input", () => {
  const pad = surface();
  const input = vi.fn(); pad.addEventListener("touchmove", input);
  touch(pad, "touchstart", [{identifier: 1, clientX: 70, clientY: 90}]);
  const event = touch(pad, "touchmove", [{identifier: 1, clientX: 90, clientY: 75}]);
  expect(pad.style.getPropertyValue("--retrom-stick-x")).toBe("20px");
  expect(pad.style.getPropertyValue("--retrom-stick-y")).toBe("-15px");
  expect(event.defaultPrevented).toBe(false);
  expect(input).toHaveBeenCalledOnce();
});

it("bounds diagonal travel and recenters on release or cancellation", () => {
  const pad = surface();
  touch(pad, "touchmove", [{identifier: 1, clientX: 170, clientY: 190}]);
  const x = parseFloat(pad.style.getPropertyValue("--retrom-stick-x"));
  const y = parseFloat(pad.style.getPropertyValue("--retrom-stick-y"));
  expect(Math.hypot(x, y)).toBeCloseTo(50);
  for (const type of ["touchend", "touchcancel"]) {
    touch(pad, "touchstart", [{identifier: 1, clientX: 90, clientY: 90}]);
    touch(pad, type, []);
    expect(pad.style.getPropertyValue("--retrom-stick-x")).toBe("");
    expect(pad.style.getPropertyValue("--retrom-stick-y")).toBe("");
  }
});

it("matches upstream release with multiple touches and releases visuals on disposal", () => {
  const pad = surface();
  touch(pad, "touchstart", [{identifier: 1, clientX: 90, clientY: 90}, {identifier: 2, clientX: 60, clientY: 90}]);
  touch(pad, "touchend", [{identifier: 2, clientX: 60, clientY: 90}]);
  expect(pad.style.getPropertyValue("--retrom-stick-x")).toBe("");
  touch(pad, "touchmove", [{identifier: 2, clientX: 60, clientY: 90}]);
  expect(pad.style.getPropertyValue("--retrom-stick-x")).toBe("-10px");
  cleanup();
  expect(pad.style.getPropertyValue("--retrom-stick-x")).toBe("");
  touch(pad, "touchmove", [{identifier: 2, clientX: 90, clientY: 90}]);
  expect(pad.style.getPropertyValue("--retrom-stick-x")).toBe("");
});
