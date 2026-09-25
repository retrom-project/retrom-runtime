import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import {requireContentSession} from "../../provider/content-inputs.js";
import {installFlycastCompatibility} from "./flycast.js";
import {resource} from "./resources.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {fileContentSource} from "../../provider/content-inputs.js";
import {rangePolicy} from "../../provider/content-policies.js";
import {contentLimits} from "../../content-io/limits.js";
import {loadFlycastDisc} from "./flycast-cache.js";
import {createNeoCDRange} from "./neocd-range.js";
import type {EjsWindow} from "./emulator-instance.js";

export async function mountNeoCDRange(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void, session: ContentSessionClient): Promise<ReturnType<typeof createNeoCDRange>> {
  const policy = rangePolicy("ASYNC", contentLimits.signedDisc);
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = createNeoCDRange(disc, reader, fail);
  runtimeWindow.RETROM_NEOCD_RANGE = range;
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_NEOCD_RANGE_V1"], range.filename);
  return range;
}

export async function mountSeekableContentRange(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, fail: (error: Error) => void, session: ContentSessionClient): Promise<ReturnType<typeof createNeoCDRange>> {
  const policy = rangePolicy("ASYNC", contentLimits.signedDisc);
  const reader = await session.open(fileContentSource(disc, policy), policy, signal);
  const range = createNeoCDRange(disc, reader, fail);
  // Prime the two bounded edge blocks before the emulator starts. Disc formats
  // commonly inspect both during load, before the first frame loop is ready.
  try {await Promise.all([range.read(0, 1), range.read(disc.sizeBytes - 1, 1)]);}
  catch (error) {await range.dispose(); throw error;}
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  runtimeWindow.EJS_gameUrl = new FileConstructor(["RETROM_CONTENT_IO_FILE_V1"], range.filename);
  return range;
}

export async function loadFlycastFile(runtimeWindow: EjsWindow, disc: {url: string; sha256: string; sizeBytes: number},
  signal: AbortSignal, progress: (loaded: number, total: number) => void, session: ContentSessionClient) {
  const blob = await loadFlycastDisc(disc, signal, progress, session);
  const FileConstructor = (runtimeWindow as Window & typeof globalThis).File;
  return new FileConstructor([blob], `${disc.sha256}.chd`);
}

export function hasSeekableGame(envelope: LaunchEnvelopeV1): boolean {
  return envelope.resources.some(entry => entry.role === "game" && entry.kind === "SEEKABLE_BLOB");
}

export async function configureContentDisc(runtimeWindow: EjsWindow, envelope: LaunchEnvelopeV1, core: string,
  signal: AbortSignal, session: ContentSessionClient | null, fail: (error: Error) => void,
  progress: (value: {loadedBytes: number; totalBytes: number}) => void) {
  const seekable = hasSeekableGame(envelope);
  if (core !== "flycast" && !seekable) {return {range: null, cleanup: null};}
  const game = resource(envelope, "game", seekable ? "SEEKABLE_BLOB" : "ROM_BLOB");
  if (core === "neocd") {return {range: await mountNeoCDRange(runtimeWindow, game, signal, fail, requireContentSession(session)), cleanup: null};}
  if (seekable) {return {range: await mountSeekableContentRange(runtimeWindow, game, signal, fail, requireContentSession(session)), cleanup: null};}
  const cleanup = installFlycastCompatibility(runtimeWindow);
  try {
    runtimeWindow.EJS_gameUrl = await loadFlycastFile(runtimeWindow, game, signal,
      (loadedBytes, totalBytes) => progress({loadedBytes, totalBytes}), requireContentSession(session));
    return {range: null, cleanup};
  } catch (error) {cleanup(); throw error;}
}
