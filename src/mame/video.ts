import type {MameCore} from "./core.js";
export function createVideo(win: Window, core: MameCore) {
  const canvas = win.document.createElement("canvas"); canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Apple II (MAME)");
  const graphics = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
  if (!graphics) {throw new Error("MAME_CANVAS_UNAVAILABLE");}
  let bitmap: ImageData | null = null;
  const draw = () => {
    const width = core._retrom_mame_width(), height = core._retrom_mame_height();
    const pointer = core._retrom_mame_pixels(), size = width * height * 4;
    if (!width || !height) {return;}
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 ||
      pointer < 1 || pointer + size > core.HEAPU8.length) {throw new Error("MAME_FRAME_INVALID");}
    if (!bitmap || canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height; bitmap = graphics.createImageData(width, height);
    }
    const source = core.HEAPU8;
    for (let i = 0; i < size; i += 4) {
      bitmap.data[i] = source[pointer + i + 2]; bitmap.data[i + 1] = source[pointer + i + 1];
      bitmap.data[i + 2] = source[pointer + i]; bitmap.data[i + 3] = 255;
    }
    graphics.putImageData(bitmap, 0, 0);
  };
  return {canvas, draw};
}

export async function captureVideo(canvas: HTMLCanvasElement, aspectRatio: number): Promise<Blob> {
  const height = Math.round(canvas.width / aspectRatio);
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0 || height < 1 || height > 4096) {throw new Error("MAME_FRAME_INVALID");}
  const image = canvas.ownerDocument.createElement("canvas"); image.width = canvas.width; image.height = height;
  const graphics = image.getContext("2d", {alpha: false});
  if (!graphics) {throw new Error("MAME_CANVAS_UNAVAILABLE");}
  graphics.imageSmoothingEnabled = false; graphics.drawImage(canvas, 0, 0, image.width, image.height);
  return new Promise<Blob>((resolve, reject) => image.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png"));
}
