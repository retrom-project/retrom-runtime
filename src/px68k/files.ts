import {contentLimits} from "../content-io/limits.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {ContentIOError} from "../content-io/errors.js";
export type FileSource = {url: string; sha256: string; sizeBytes: number};
export async function fetchFile(source: FileSource, progress: (loaded: number) => void, signal?: AbortSignal,
  session?: AdapterContentSession, purpose: "GAME" | "FIRMWARE" | "CORE_ASSET" = "GAME", maximum: number = contentLimits.firmwareFile) {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > maximum ||
    !/^[0-9a-f]{64}$/u.test(source.sha256)) {throw new Error("PX68K_FILE_INVALID");}
  if (!session) {throw new ContentIOError("ABI_MISMATCH");}
  return materializeFileBytes(session, source, eagerPolicy(maximum), purpose, signal, value => progress(value.readyBytes));
}
