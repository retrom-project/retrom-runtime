import {contentLimits} from "../content-io/limits.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import type {PreparationProgress} from "../content-io/progress.js";
import {ContentIOError} from "../content-io/errors.js";
export async function verifiedFetch(url: string, size: number, digest: string, signal?: AbortSignal,
  session?: AdapterContentSession, purpose: "GAME" | "CORE_ASSET" = "GAME", report?: (value: PreparationProgress) => void) {
  if (!Number.isSafeInteger(size) || size < 1 || size > contentLimits.fantasyFile) {throw new Error("FANTASY_CONTENT_SIZE_INVALID");}
  if (!session) {throw new ContentIOError("ABI_MISMATCH");}
  return materializeFileBytes(session, {url, sizeBytes: size, sha256: digest}, eagerPolicy(contentLimits.fantasyFile), purpose, signal, report);
}
