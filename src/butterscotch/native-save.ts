import {sha256} from "@noble/hashes/sha2.js";
import type {CheckpointAvailability, RuntimeCheckpoint} from "../contract.js";
import type {RuntimeExitSnapshot} from "../internal-adapter.js";

export const nativeSaveFormat = "butterscotch-game-save-v1";
const save = {dataKind: "STORAGE", capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false} as const;

export function nativeSaves(restore: Uint8Array | null) {
  let baseline = restore ? signature(restore) : "";
  let current: {available?: boolean; status?: string; revision?: string} = {status: "NOT_READY"};
  const exports = new Map<string, number>();
  let sequence = 0, acknowledged = 0;
  const capture = (bytes: Uint8Array | null): RuntimeCheckpoint => {
    if (!bytes?.byteLength || bytes.byteLength > 16 * 1024 * 1024) {throw new Error("BUTTERSCOTCH_NATIVE_SAVE_INVALID");}
    const revision = signature(bytes);
    current = {available: true, status: "READY", revision};
    exports.set(revision, ++sequence);
    while (exports.size > 32) {exports.delete(exports.keys().next().value!);}
    return {bytes, format: nativeSaveFormat, screenshot: "UNCHANGED"};
  };
  return {
    update(status: typeof current) {current = status;},
    availability(): CheckpointAvailability {
      if (current.available && current.revision) {
        return current.revision === baseline ? {available: false, blocker: "UNCHANGED", save}
          : {available: true, blocker: null, revision: current.revision, save};
      }
      return {available: false, blocker: current.status === "NO_SAVE" ? "NO_SAVE"
        : current.status === "NOT_READY" ? "NOT_READY" : "FAILED", save};
    },
    capture,
    acknowledge(checkpoint: RuntimeCheckpoint) {
      const revision = signature(checkpoint.bytes), exported = exports.get(revision);
      if (checkpoint.format !== nativeSaveFormat || exported === undefined) {throw new Error("BUTTERSCOTCH_NATIVE_SAVE_INVALID");}
      if (exported >= acknowledged) {baseline = revision; acknowledged = exported;}
    },
    final(bytes: Uint8Array | null): RuntimeExitSnapshot | undefined {
      if (!bytes?.byteLength || signature(bytes) === baseline) {return undefined;}
      return {checkpoint: capture(bytes), screenshot: null};
    },
  };
}
function signature(bytes: Uint8Array) {return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, "0")).join("");}
