import {contentLimits} from "../content-io/limits.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {ContentIOError} from "../content-io/errors.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type MediaSource = {mediaUrl: string; mediaSizeBytes: number; contentDigest: string};
export const maximumMediaBytes = contentLimits.webmsxMedia;
export async function fetchMedia(source: MediaSource, progress: RuntimeProgressReporter,
  session?: AdapterContentSession, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(source.mediaSizeBytes) || source.mediaSizeBytes < 8 || source.mediaSizeBytes > maximumMediaBytes ||
    !/^[a-f0-9]{64}$/u.test(source.contentDigest)) {throw invalid();}
  if (!session) {throw new ContentIOError("ABI_MISMATCH");}
  const bytes = await materializeFileBytes(session, {url: source.mediaUrl, sizeBytes: source.mediaSizeBytes, sha256: source.contentDigest},
    eagerPolicy(maximumMediaBytes), "GAME", signal,
    value => progress({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: source.mediaSizeBytes}));
  return bytes;
}
function invalid() {return new Error("WEBMSX_CONTENT_INVALID");}
