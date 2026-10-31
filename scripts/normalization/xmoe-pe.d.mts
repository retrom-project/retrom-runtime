import type {XmoeProfile} from "./xmoe-codec.mjs";
export function probeXmoeCompanion(bytes: Uint8Array, signal?: AbortSignal): (XmoeProfile & {evidence: Record<string, unknown>}) | null;
