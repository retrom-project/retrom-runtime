import {maximumKirikiriCheckpointBytes, maximumKirikiriCheckpointEntries, validKirikiriCheckpointPath} from "./checkpoint.js";

/** Native writes belong to this isolated virtual filesystem, not Host paths.
 * Games can choose their own user directory; retain the original relative
 * location so a new instance sees exactly the path the game will read. */
export class KirikiriWriteOverlay {
  readonly writes = new Map<string, Uint8Array | null>();
  readonly sequences = new Map<string, number>();
  readonly progressPaths = new Set<string>();
  sequence = 0;
  lastWriteAt = 0;
  acknowledged = 0;
  private bytes = 0;
  private failure: Error | undefined;
  private readonly pending = new Map<number, Set<string>>();
  private readonly tainted = new Set<string>();

  record(path: string, data: Uint8Array | null) {
    if (this.failure) {return;}
    const normalized = path.replace(/^\/+/, "");
    const size = this.bytes - (this.writes.get(normalized)?.byteLength ?? 0) + (data?.byteLength ?? 0);
    const count = this.writes.size + (this.writes.has(normalized) ? 0 : 1);
    if (!validKirikiriCheckpointPath(normalized) || size > maximumKirikiriCheckpointBytes || count > maximumKirikiriCheckpointEntries) {
      // Do not duplicate an unbounded native write or publish a partial save.
      // Keep play independent from the checkpoint's explicit size/path limits.
      this.failure = new Error("KIRIKIRI_CHECKPOINT_INVALID");
      return;
    }
    for (const paths of this.pending.values()) {paths.add(normalized);}
    const previous = this.writes.get(normalized);
    if (data === null) {this.tainted.delete(normalized);}
    if (sameData(previous, data)) {return;}
    this.writes.set(normalized, data?.slice() ?? null);
    this.sequences.set(normalized, ++this.sequence);
    this.lastWriteAt = Date.now();
    this.bytes = size;
  }

  requireValid() {if (this.failure) {throw this.failure;}}

  observe(event: {phase: "begin" | "end"; id: number; success?: boolean}) {
    if (!Number.isSafeInteger(event.id) || event.id < 1) {this.invalid(); return;}
    if (event.phase === "begin") {
      if (this.pending.has(event.id) || this.pending.size >= 32) {this.invalid(); return;}
      this.pending.set(event.id, new Set());
      return;
    }
    const paths = this.pending.get(event.id);
    if (event.phase !== "end" || !paths || typeof event.success !== "boolean") {this.invalid(); return;}
    this.pending.delete(event.id);
    if (!event.success) {
      this.retainFailedWrites(paths);
      return;
    }
    let changed = false;
    for (const path of paths) {
      this.tainted.delete(path);
      if ((this.writes.get(path)?.byteLength ?? 0) > 0 && !this.progressPaths.has(path)) {
        this.progressPaths.add(path); changed = true;
      }
    }
    if (changed) {++this.sequence; this.lastWriteAt = Date.now();}
  }

  seedProgress(paths: readonly string[]) {
    for (const path of paths) {this.progressPaths.add(path);}
    this.acknowledged = this.sequence;
  }

  availability() {
    if (this.failure || this.pending.size || this.tainted.size) {return "NOT_READY";}
    if (!this.progressPaths.size) {return "NO_SAVE";}
    return this.sequence === this.acknowledged ? "UNCHANGED" : null;
  }

  private invalid() {this.failure = new Error("KIRIKIRI_SAVE_OBSERVER_INVALID");}

  private retainFailedWrites(paths: Set<string>) {
    // A failed native writer can already have removed its temporary file.
    // Keep real failed remnants and previous progress slots fenced, while
    // permitting a cleaned-up temporary path to remain a harmless tombstone.
    for (const path of paths) {
      if (this.writes.get(path) !== null || this.progressPaths.has(path)) {this.tainted.add(path);}
    }
  }
}

function sameData(previous: Uint8Array | null | undefined, current: Uint8Array | null) {
  if (previous === null || current === null) {return previous === current;}
  return previous !== undefined && previous.byteLength === current.byteLength &&
    previous.every((value, i) => value === current[i]);
}
