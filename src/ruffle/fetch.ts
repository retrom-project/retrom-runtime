import {contentLimits} from "../content-io/limits.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {ContentIOError} from "../content-io/errors.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type SwfSource = {swfUrl: string; swfSizeBytes: number; contentDigest: string};
export const maximumSwfBytes = contentLimits.ruffleSwf;
export async function fetchSwf(source: SwfSource, progress: RuntimeProgressReporter,
  session?: AdapterContentSession, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(source.swfSizeBytes) || source.swfSizeBytes < 8 || source.swfSizeBytes > maximumSwfBytes ||
    !/^[a-f0-9]{64}$/u.test(source.contentDigest)) {throw invalid();}
  if (!session) {throw new ContentIOError("ABI_MISMATCH");}
  const bytes = await materializeFileBytes(session, {url: source.swfUrl, sizeBytes: source.swfSizeBytes, sha256: source.contentDigest},
    eagerPolicy(maximumSwfBytes), "GAME", signal,
    value => progress({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: source.swfSizeBytes}));
  validateHeader(bytes);
  return bytes;
}
function invalid() {return new Error("RUFFLE_CONTENT_INVALID");}
function validateHeader(bytes: Uint8Array) {
  const signature = String.fromCharCode(...bytes.subarray(0, 3));
  const declaredSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (!["FWS", "CWS", "ZWS"].includes(signature) || bytes[3] === 0 || declaredSize < 8 || declaredSize > maximumSwfBytes ||
    signature === "FWS" && declaredSize !== bytes.length || signature === "CWS" && bytes[3] < 6 ||
    signature === "ZWS" && (bytes[3] < 13 || bytes.length < 17)) {throw invalid();}
}
