import {loadDisc} from "./disc-cache.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
export function loadFlycastDisc(disc: {url: string; sizeBytes: number; sha256: string}, signal: AbortSignal,
  progress: (loaded: number, total: number) => void, session: AdapterContentSession) {
  return loadDisc(disc, signal, progress, session);
}
