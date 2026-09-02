import {describe, expect, it, vi} from "vitest";

import {
  captureEmulatorJsScreenshot,
  coreFramebufferNeedsCanvasOrientation,
  screenshotPixelsHaveVisibleContent,
} from "./screenshot.js";

describe("EmulatorJS Provider screenshots", () => {
  it("detects a core framebuffer whose dimensions need the displayed canvas orientation", () => {
    const portrait = pngWithDimensions(256, 224);
    expect(coreFramebufferNeedsCanvasOrientation(portrait, 3 / 4)).toBe(true);
    expect(coreFramebufferNeedsCanvasOrientation(portrait, 4 / 3)).toBe(false);
  });

  it("uses a visible core framebuffer and falls back to EmulatorJS display capture", async () => {
    const screenshot = pngWithDimensions(320, 240);
    const takeScreenshot = vi.fn(async () => ({blob: new Blob(["displayed"]), format: "png"}));
    const instance = {
      capture: {photo: {format: "png", source: "canvas", upscale: 2}},
      gameManager: {
        FS: {readFile: () => screenshot, stat: () => ({size: screenshot.byteLength}), unlink: vi.fn()},
        functions: {screenshot: vi.fn()},
        getVideoDimensions: () => 4 / 3,
      },
      takeScreenshot,
    };
    await expect(captureEmulatorJsScreenshot(instance)).resolves.toMatchObject({size: screenshot.byteLength});
    expect(takeScreenshot).not.toHaveBeenCalled();

    instance.gameManager.getVideoDimensions = () => 3 / 4;
    await expect(captureEmulatorJsScreenshot(instance)).resolves.toMatchObject({size: 9});
    expect(takeScreenshot).toHaveBeenCalledWith("canvas", "png", 2);
  });

  it("rejects all-black samples as non-visible", () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    expect(screenshotPixelsHaveVisibleContent(pixels)).toBe(false);
    for (let pixel = 0; pixel < 42; pixel += 1) {
      pixels.fill(64, pixel * 4, pixel * 4 + 3);
    }
    expect(screenshotPixelsHaveVisibleContent(pixels)).toBe(true);
  });
});

function pngWithDimensions(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
