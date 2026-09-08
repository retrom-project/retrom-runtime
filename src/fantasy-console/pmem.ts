import type {CheckpointAvailability} from "../contract.js";
import type {NativeCore} from "./core.js";

/** Tracks native game-save bytes independently of frame updates and upload completion. */
export class PersistentMemory {
  private acknowledged: Uint8Array;
  private observed = new Uint8Array(1024);
  private revision = 0;
  private hasSaved: boolean;
  constructor(private readonly core: NativeCore, restored: Uint8Array | null) {
    this.acknowledged = restored?.slice() ?? new Uint8Array(1024);
    this.hasSaved = restored !== null;
  }
  availability(): CheckpointAvailability {
    const pointer = this.core._retrom_state();
    if (!pointer || pointer + 1024 > this.core.HEAPU8.length) {return {available: false, blocker: "FAILED"};}
    const current = this.core.HEAPU8.subarray(pointer, pointer + 1024);
    if (!same(current, this.observed)) {this.observed = current.slice(); this.revision++;}
    if (same(current, this.acknowledged)) {
      return {available: false, blocker: this.hasSaved ? "UNCHANGED" : "NO_SAVE"};
    }
    return {available: true, blocker: null, revision: String(this.revision)};
  }
  acknowledge(bytes: Uint8Array) {this.acknowledged = bytes.slice(); this.hasSaved = true;}
}
function same(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
