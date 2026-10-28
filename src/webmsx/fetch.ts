import {contentLimits} from "../content-io/limits.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import {materializeGameFile} from "../provider/game-file.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type MediaSource = {mediaUrl: string; mediaSizeBytes: number; contentDigest: string};
export const maximumMediaBytes = contentLimits.webmsxMedia;
export async function fetchMedia(source: MediaSource, progress: RuntimeProgressReporter,
  session?: AdapterContentSession, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(source.mediaSizeBytes) || source.mediaSizeBytes < 8 || source.mediaSizeBytes > maximumMediaBytes ||
    !/^[a-f0-9]{64}$/u.test(source.contentDigest)) {throw invalid();}
  const bytes = await materializeGameFile({url: source.mediaUrl, sizeBytes: source.mediaSizeBytes, sha256: source.contentDigest},
    progress, session, signal);
  return bytes;
}
function invalid() {return new Error("WEBMSX_CONTENT_INVALID");}
