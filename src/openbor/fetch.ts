import {contentLimits} from "../content-io/limits.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {ContentIOError} from "../content-io/errors.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type PakSource = {url: string; sizeBytes: number; sha256: string};
export const maximumPakBytes = contentLimits.openborPak;
export async function fetchPak(source: PakSource, progress: RuntimeProgressReporter, session?: AdapterContentSession,
  signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 12 || source.sizeBytes > maximumPakBytes ||
    !/^[a-f0-9]{64}$/u.test(source.sha256)) {throw new Error("OPENBOR_CONTENT_INVALID");}
  if (!session) {throw new ContentIOError("ABI_MISMATCH");}
  const bytes = await materializeFileBytes(session, source, eagerPolicy(maximumPakBytes), "GAME", signal,
    value => progress({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: source.sizeBytes}));
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "PACK" ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) !== 0) {throw new Error("OPENBOR_CONTENT_INVALID");}
  return bytes as Uint8Array<ArrayBuffer>;
}
