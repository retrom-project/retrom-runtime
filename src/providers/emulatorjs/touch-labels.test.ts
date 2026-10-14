import {afterEach, expect, it, vi} from "vitest";
import {installEmulatorJsFrameStyle} from "./surface.js";

let cleanup = () => {};
afterEach(() => {cleanup(); document.body.replaceChildren();});

function button(text: string) {
  const element = document.createElement("div");
  element.className = "ejs_virtualGamepad_button";
  element.textContent = text;
  document.body.append(element);
  return element;
}

it("centers labels created or replaced by upstream without replacing the input button", async () => {
  const existing = button("A");
  const listener = vi.fn();
  existing.addEventListener("touchstart", listener);
  cleanup = installEmulatorJsFrameStyle(document);
  const late = button("Keyboard");
  await vi.waitFor(() => expect(late.querySelector(".retrom-touch-label")?.textContent).toBe("Keyboard"));
  expect(existing.querySelector(".retrom-touch-label")?.textContent).toBe("A");
  existing.dispatchEvent(new Event("touchstart"));
  expect(listener).toHaveBeenCalledOnce();
  late.textContent = "开始";
  await vi.waitFor(() => expect(late.querySelector(".retrom-touch-label")?.textContent).toBe("开始"));
  expect(late.querySelectorAll(".retrom-touch-label")).toHaveLength(1);
});

it("disposes observation and restores text, including detached controls", async () => {
  cleanup = installEmulatorJsFrameStyle(document);
  const existing = button("B");
  await vi.waitFor(() => expect(existing.querySelector(".retrom-touch-label")).not.toBeNull());
  existing.remove();
  cleanup();
  expect(existing.textContent).toBe("B");
  expect(existing.children).toHaveLength(0);
  const after = button("X");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(after.children).toHaveLength(0);
});

it("recenters visible glyphs after layout and font changes, then releases observers", async () => {
  const existing = button("开始");
  let resized = () => {};
  const disconnect = vi.fn();
  const fonts = new EventTarget();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) {resized = callback;}
    observe() {}
    disconnect = disconnect;
  });
  Object.defineProperty(document, "fonts", {value: fonts, configurable: true});
  vi.spyOn(existing, "getBoundingClientRect").mockReturnValue({top: 0, height: 30, width: 50} as DOMRect);
  let ascent = 14;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "", measureText: () => ({fontBoundingBoxAscent: 15, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: 2}),
  } as unknown as CanvasRenderingContext2D);
  const rectangle = vi.fn(() => {
    const applied = Number.parseFloat((existing.firstElementChild as HTMLElement | null)?.style.getPropertyValue("--retrom-touch-label-shift") ?? "0") || 0;
    return {top: 7 + applied, height: 18, width: 30} as DOMRect;
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {value: rectangle, configurable: true});
  try {
    cleanup = installEmulatorJsFrameStyle(document);
    const label = existing.firstElementChild as HTMLElement;
    await vi.waitFor(() => expect(label.style.getPropertyValue("--retrom-touch-label-shift")).toBe("-1px"));
    resized();
    expect(label.style.getPropertyValue("--retrom-touch-label-shift")).toBe("-1px");
    ascent = 12;
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(label.style.getPropertyValue("--retrom-touch-label-shift")).toBe("-2px");
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    rectangle.mockClear();
    resized(); fonts.dispatchEvent(new Event("loadingdone")); window.dispatchEvent(new Event("resize"));
    expect(rectangle).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(document, "fonts");
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    vi.unstubAllGlobals();
  }
});
