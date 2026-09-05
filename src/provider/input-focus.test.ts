import {afterEach, describe, expect, it, vi} from "vitest";
import {focusRuntimeInput} from "./input-focus.js";

afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks();});

describe("runtime input focus", () => {
  it("focuses a real child-document canvas without relying on cross-realm instanceof", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const child = frame.contentDocument!;
    const canvas = child.createElement("canvas");
    child.body.append(canvas);
    focusRuntimeInput(canvas, frame.contentWindow);
    expect(canvas.tabIndex).toBe(0);
    expect(child.activeElement).toBe(canvas);
  });

  it("can focus a window-only runtime without reading its isolated document", () => {
    const focus = vi.fn();
    const isolated = {focus, get document() {throw new Error("cross origin");}} as unknown as Window;
    focusRuntimeInput(null, isolated);
    expect(focus).toHaveBeenCalledOnce();
    expect(() => focusRuntimeInput(null, null)).not.toThrow();
  });
});
