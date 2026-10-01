import {describe, expect, it, vi} from "vitest";
import {retainEmulatorJsDisplayedFrame} from "./displayed-frame.js";

describe("EmulatorJS displayed frame retention", () => {
  it("retains the displayed WebGL frame through pause and leaves other realms and 2D capture unchanged", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const target = frame.contentWindow as Window & typeof globalThis;
    const original = vi.spyOn(target.HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const parentContext = HTMLCanvasElement.prototype.getContext;
    const attributes = {alpha: false, antialias: false, preserveDrawingBuffer: false};
    const cleanup = retainEmulatorJsDisplayedFrame(target);
    const canvas = target.document.createElement("canvas");
    try {
      canvas.getContext("webgl2", attributes);
      expect(original).toHaveBeenLastCalledWith("webgl2", {...attributes, preserveDrawingBuffer: true});
      expect(attributes.preserveDrawingBuffer).toBe(false);
      canvas.getContext("2d", {alpha: false});
      expect(original).toHaveBeenLastCalledWith("2d", {alpha: false});
      expect(HTMLCanvasElement.prototype.getContext).toBe(parentContext);
      cleanup();
      canvas.getContext("webgl2", attributes);
      expect(original).toHaveBeenLastCalledWith("webgl2", attributes);
    } finally {cleanup(); original.mockRestore(); frame.remove();}
  });
});
