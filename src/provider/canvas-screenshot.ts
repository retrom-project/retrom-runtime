export async function canvasScreenshot(canvas: HTMLCanvasElement, requireActive: () => void): Promise<Blob> {
  requireActive();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob?.size
    ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png"));
}
