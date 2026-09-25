import {describe, expect, it, vi} from "vitest";
import {installFlycastCompatibility} from "./flycast.js";

describe("Flycast frontend compatibility", () => {
  it("retains the displayed WebGL frame through pause and leaves other realms and 2D capture unchanged", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const target = frame.contentWindow as Window & typeof globalThis;
    const original = vi.spyOn(target.HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const parentContext = HTMLCanvasElement.prototype.getContext;
    const attributes = {alpha: false, antialias: false, preserveDrawingBuffer: false};
    const cleanup = installFlycastCompatibility(target);
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
  it("selects WebGL2 before startup and restores the frontend on cleanup", () => {
    const target = window as Window & {EmulatorJS?: {prototype: {requiresWebGL2: (core: string) => boolean}}};
    const cleanup = installFlycastCompatibility(target);
    const original = vi.fn((core: string) => core === "ppsspp");
    target.EmulatorJS = {prototype: {requiresWebGL2: original}};
    expect(target.EmulatorJS.prototype.requiresWebGL2("flycast")).toBe(true);
    expect(target.EmulatorJS.prototype.requiresWebGL2("ppsspp")).toBe(true);
    expect(target.EmulatorJS.prototype.requiresWebGL2("mgba")).toBe(false);
    cleanup();
    expect(target.EmulatorJS.prototype.requiresWebGL2).toBe(original);
    Reflect.deleteProperty(target, "EmulatorJS");
  });
  it("passes Flycast cartridge ZIP through the 4.2.3 ROM loader without extracting it", async () => {
    const target = window as Window & {EmulatorJS?: {prototype: {
      requiresWebGL2: (core: string) => boolean;
      checkCompression: (data: Uint8Array, message: string, callback?: (name: string, bytes: Uint8Array) => void) => Promise<unknown>;
      localization: (message: string) => string;
      getCore: () => string;
      config: {gameUrl: string};
    }}};
    const original = vi.fn(async () => ({"part.rom": new Uint8Array([1])}));
    const cleanup = installFlycastCompatibility(target);
    target.EmulatorJS = {prototype: {requiresWebGL2: () => false, checkCompression: original,
      localization: (message) => message, getCore: () => "flycast", config: {gameUrl: "pstone2.zip"}}};
    const callback = vi.fn();
    const bytes = new Uint8Array([80, 75, 3, 4]);
    try {
      await target.EmulatorJS.prototype.checkCompression(bytes, "Decompress Game Data", callback);
      expect(callback).toHaveBeenCalledWith("!!notCompressedData", bytes);
      expect(original).not.toHaveBeenCalled();
      await target.EmulatorJS.prototype.checkCompression(bytes, "Decompress Game Core", callback);
      expect(original).toHaveBeenCalledOnce();
    } finally {cleanup(); Reflect.deleteProperty(target, "EmulatorJS");}
    expect(target.EmulatorJS).toBeUndefined();
  });
});
