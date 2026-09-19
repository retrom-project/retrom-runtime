import {contentLimits} from "../content-io/limits.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
/** The public materializer verifies complete executable assets before core registration. */
export async function loadPSPFile(source: {url: string; sizeBytes: number; sha256: string}, signal?: AbortSignal,
  session?: AdapterContentSession): Promise<void> {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > contentLimits.pspAsset ||
    !/^[0-9a-f]{64}$/u.test(source.sha256)) {throw new Error("PPSSPP_CONTENT_INVALID");}
  signal?.throwIfAborted(); if (!session) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  await materializeFileBytes(session, source, eagerPolicy(contentLimits.pspAsset), "CORE_ASSET", signal);
}
