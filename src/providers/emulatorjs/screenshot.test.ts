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
      capture: {photo: {format: "png", source: "retroarch", upscale: 2}},
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

  it("temporarily resumes native framebuffer capture and restores pause", async () => {
    const request = vi.fn();
    const toggleMainLoop = vi.fn();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const ForeignBlob = (frame.contentWindow as unknown as {Blob: typeof Blob}).Blob;
    const takeScreenshot = vi.fn(async () => ({blob: new ForeignBlob(["displayed"]), format: "png"}));
    const gameManager = {
      FS: {readFile: () => pngWithDimensions(320, 240), stat: () => ({size: 24})},
      functions: {screenshot: request}, getVideoDimensions: () => 4 / 3,
      toggleMainLoop(this: unknown, running: boolean) {
        if (this !== gameManager) {throw new Error("toggleMainLoop lost its receiver");}
        toggleMainLoop(running);
      },
    };
    const captured = await captureEmulatorJsScreenshot({
      paused: true,
      capture: {photo: {format: "png", source: "retroarch", upscale: 1}},
      gameManager,
      takeScreenshot,
    });
    expect(captured).toMatchObject({type: "image/png"});
    expect(captured).toBeInstanceOf(Blob);
    expect(request).toHaveBeenCalledOnce();
    expect(toggleMainLoop.mock.calls).toEqual([[true], [false]]);
    expect(takeScreenshot).not.toHaveBeenCalled();
  });

  it("normalizes the byte result returned by the distributed EmulatorJS build", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const ForeignUint8Array = (frame.contentWindow as Window & typeof globalThis).Uint8Array;
    const displayed = new ForeignUint8Array([1, 2, 3, 4]);

    const captured = await captureEmulatorJsScreenshot({
      paused: true,
      capture: {photo: {format: "png", source: "retroarch", upscale: 1}},
      takeScreenshot: vi.fn(async () => ({screenshot: displayed, format: "png"})),
    });

    expect(captured).toBeInstanceOf(Blob);
    expect(captured).toMatchObject({size: 4, type: "image/png"});
    expect(new Uint8Array(await captured.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
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
