import {loadFlycastDisc} from "./flycast-cache.js";
import {createNeoCDRange} from "./neocd-range.js";
import type {EjsWindow} from "./emulator-instance.js";

export function mountNeoCDRange(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void): ReturnType<typeof createNeoCDRange> {
  const range = createNeoCDRange(disc, signal, fail);
  runtimeWindow.RETROM_NEOCD_RANGE = range;
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_NEOCD_RANGE_V1"], range.filename);
  return range;
}

export async function loadFlycastFile(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, progress: (loaded: number, total: number) => void) {
  const blob = await loadFlycastDisc(disc, signal, progress);
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  return new FileConstructor([blob], `${disc.sha256}.chd`);
}
