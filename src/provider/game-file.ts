import {ContentIOError} from "../content-io/errors.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
import {materializeFileBytes, type AdapterContentSession} from "./content-inputs.js";

/** Materialize a game file through the selected policy and report its actual progress. */
export function materializeGameFile(source: {url: string; sizeBytes: number; sha256: string},
  progress: RuntimeProgressReporter, session?: AdapterContentSession, signal?: AbortSignal) {
  if (!session) {throw new ContentIOError("ABI_MISMATCH");}
  return materializeFileBytes(session, source, session.inputPolicy("game"), "GAME", signal,
    value => progress({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: source.sizeBytes}));
}
