type ScreenshotInstance = {
  capture?: {photo?: {source?: string; format?: string; upscale?: number}};
  gameManager?: {
    FS?: {
      readFile?: (path: string) => ArrayBufferView;
      stat?: (path: string) => {size: number};
      unlink?: (path: string) => void;
    };
    functions?: {screenshot?: () => void};
    getVideoDimensions?: (dimension: "aspect") => number | undefined;
  };
  takeScreenshot?: (source: string, format: string, upscale: number) =>
    Promise<{blob: Blob; format: string}>;
};

const coreScreenshotTimeoutMs = 2_000;
const sampleSide = 64;

export async function captureEmulatorJsScreenshot(instance: ScreenshotInstance): Promise<Blob> {
  try {
    const core = await captureCoreFramebuffer(instance);
    if (await screenshotHasVisibleContent(core)) {return core;}
  } catch {
    // Displayed output is the bounded fallback for missing, blank, or incorrectly oriented core output.
  }
  return captureDisplayedOutput(instance);
}

export function screenshotPixelsHaveVisibleContent(pixels: Uint8ClampedArray) {
  const required = Math.ceil(pixels.length / 4 * 0.01);
  let visible = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luma = ((pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0)) / 3;
    if (luma > 8 && ++visible >= required) {return true;}
  }
  return false;
}

export function coreFramebufferNeedsCanvasOrientation(bytes: Uint8Array, expectedAspect: number | undefined) {
  if (!Number.isFinite(expectedAspect) || !expectedAspect || expectedAspect <= 0 || bytes.byteLength < 24 ||
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
    bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return false;
  }
  const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dimensions.getUint32(16);
  const height = dimensions.getUint32(20);
  if (!width || !height) {return false;}
  const directError = Math.abs(Math.log(width / height / expectedAspect));
  const rotatedError = Math.abs(Math.log(height / width / expectedAspect));
  return rotatedError + 0.05 < directError;
}

async function captureDisplayedOutput(instance: ScreenshotInstance) {
  if (!instance.takeScreenshot) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
  const photo = instance.capture?.photo;
  const result = await instance.takeScreenshot(
    photo?.source ?? "canvas", photo?.format ?? "png", photo?.upscale ?? 1,
  );
  if (!result.blob || typeof result.blob.size !== "number" || result.blob.size < 1) {
    throw new Error("PLAYER_SCREENSHOT_EMPTY");
  }
  return result.blob;
}

async function captureCoreFramebuffer(instance: ScreenshotInstance) {
  const fileSystem = instance.gameManager?.FS;
  const request = instance.gameManager?.functions?.screenshot;
  if (!fileSystem?.readFile || !fileSystem.stat || !request) {
    throw new Error("PLAYER_CORE_SCREENSHOT_UNAVAILABLE");
  }
  try {fileSystem.unlink?.("/screenshot.png");} catch { /* The previous capture is optional. */ }
  request();
  const deadline = Date.now() + coreScreenshotTimeoutMs;
  while (Date.now() <= deadline) {
    const screenshot = readCoreScreenshot(instance);
    if (screenshot) {return screenshot;}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("PLAYER_CORE_SCREENSHOT_TIMEOUT");
}

function readCoreScreenshot(instance: ScreenshotInstance) {
  const fileSystem = instance.gameManager?.FS;
  if (!fileSystem?.readFile || !fileSystem.stat) {return null;}
  try {
    fileSystem.stat("/screenshot.png");
    const source = fileSystem.readFile("/screenshot.png");
    if (!source.byteLength) {return null;}
    const bytes = Uint8Array.from(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    if (coreFramebufferNeedsCanvasOrientation(bytes, instance.gameManager?.getVideoDimensions?.("aspect"))) {
      throw new Error("PLAYER_CORE_SCREENSHOT_ORIENTATION_MISMATCH");
    }
    return new Blob([bytes], {type: "image/png"});
  } catch (error) {
    if (error instanceof Error && error.message === "PLAYER_CORE_SCREENSHOT_ORIENTATION_MISMATCH") {throw error;}
    return null;
  }
}

async function screenshotHasVisibleContent(screenshot: Blob) {
  if (typeof createImageBitmap !== "function") {return true;}
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(screenshot);
    const sample = document.createElement("canvas");
    sample.width = sampleSide;
    sample.height = sampleSide;
    const context = sample.getContext("2d", {alpha: false});
    if (!context) {return false;}
    context.drawImage(bitmap, 0, 0, sampleSide, sampleSide);
    return screenshotPixelsHaveVisibleContent(context.getImageData(0, 0, sampleSide, sampleSide).data);
  } catch {
    return false;
  } finally {
    bitmap?.close();
  }
}
