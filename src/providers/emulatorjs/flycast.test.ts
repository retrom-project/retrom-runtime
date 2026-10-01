import {describe, expect, it, vi} from "vitest";
import {installFlycastCompatibility} from "./flycast.js";

describe("Flycast frontend compatibility", () => {
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
