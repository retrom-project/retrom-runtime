import {afterEach, describe, expect, it, vi} from "vitest";

import {
  captureEmulatorJsScreenshot,
  coreFramebufferNeedsCanvasOrientation,
  screenshotPixelsHaveVisibleContent,
} from "./screenshot.js";

describe("EmulatorJS Provider screenshots", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([[768, 280, 4 / 3, 768, 576], [256, 240, 4 / 3, 320, 240]])(
    "corrects non-square pixels in a %i × %i core capture without cropping",
    async (width, height, aspect, expectedWidth, expectedHeight) => {
      const bytes = pngWithDimensions(width, height);
      const bitmap = {width, height, close: vi.fn()};
      vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
      const drawImage = vi.fn();
      const context = {drawImage, imageSmoothingEnabled: true,
        getImageData: () => ({data: new Uint8ClampedArray(64 * 64 * 4).fill(255)})};
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
      const pause = vi.fn();
      const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
        expect(pause.mock.calls).toEqual([[true], [false]]);
        callback(new Blob([pngWithDimensions(this.width, this.height)], {type: "image/png"}));
      });
      const takeScreenshot = vi.fn();
      const result = await captureEmulatorJsScreenshot({paused: true, takeScreenshot, gameManager: {
        FS: {readFile: () => bytes, stat: () => ({size: bytes.length})},
        functions: {screenshot: vi.fn()}, toggleMainLoop: pause, getVideoDimensions: () => aspect,
      }});
      const output = new DataView(await result.arrayBuffer());
      expect([output.getUint32(16), output.getUint32(20)]).toEqual([expectedWidth, expectedHeight]);
      expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, expectedWidth, expectedHeight);
      expect(toBlob).toHaveBeenCalledOnce();
      expect(takeScreenshot).not.toHaveBeenCalled();
      expect(bitmap.close).toHaveBeenCalled();
    },
  );

  it.each([4 / 3, undefined, NaN, 0])("preserves an already proportioned PNG with aspect %s", async (aspect) => {
    const bytes = pngWithDimensions(640, 480);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({width: 640, height: 480, close: vi.fn()})));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({drawImage: vi.fn(),
      getImageData: () => ({data: new Uint8ClampedArray(64 * 64 * 4).fill(255)})} as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    const captured = await captureEmulatorJsScreenshot({gameManager: {
      FS: {readFile: () => bytes, stat: () => ({size: bytes.length})},
      functions: {screenshot: vi.fn()}, getVideoDimensions: () => aspect,
    }});
    expect(new Uint8Array(await captured.arrayBuffer())).toEqual(bytes);
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("falls back to displayed output if aspect correction cannot encode an image", async () => {
    const bytes = pngWithDimensions(768, 280), close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({width: 768, height: 280, close})));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({drawImage: vi.fn(),
      getImageData: () => ({data: new Uint8ClampedArray(64 * 64 * 4).fill(255)})} as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(null));
    const takeScreenshot = vi.fn(async () => ({blob: new Blob(["displayed"]), format: "png"}));
    const captured = await captureEmulatorJsScreenshot({takeScreenshot, gameManager: {
      FS: {readFile: () => bytes, stat: () => ({size: bytes.length})},
      functions: {screenshot: vi.fn()}, getVideoDimensions: () => 4 / 3,
    }});
    expect(await captured.text()).toBe("displayed");
    expect(takeScreenshot).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(2);
  });

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
