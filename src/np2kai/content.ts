import {contentLimits} from "../content-io/limits.js";
import {materializeFileBytes, type AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {ContentIOError} from "../content-io/errors.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type DiskSource = {url: string; sha256: string; sizeBytes: number};
export async function loadDisk(source: DiskSource, progress: RuntimeProgressReporter, session?: AdapterContentSession,
  signal?: AbortSignal, purpose: "GAME" | "CORE_ASSET" = "GAME") {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > contentLimits.np2kaiDisk ||
    !/^[0-9a-f]{64}$/u.test(source.sha256)) {throw new Error("NP2KAI_DISK_INVALID");}
  if (!session) {throw new ContentIOError("ABI_MISMATCH");}
  return materializeFileBytes(session, source, eagerPolicy(contentLimits.np2kaiDisk), purpose, signal,
    value => progress({phase: purpose === "GAME" ? "PROJECT_CONTENT" : "RUNTIME_ASSET", loadedBytes: value.readyBytes, totalBytes: source.sizeBytes}));
}
