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
