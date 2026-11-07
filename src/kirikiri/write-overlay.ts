import {maximumKirikiriCheckpointBytes, maximumKirikiriCheckpointEntries, validKirikiriCheckpointPath} from "./checkpoint.js";

/** Native writes belong to this isolated virtual filesystem, not Host paths.
 * Games can choose their own user directory; retain the original relative
 * location so a new instance sees exactly the path the game will read. */
export type KirikiriSaveImage = {width: number; height: number; pixels: Uint8Array};

/** Games may rewrite system files every few seconds; publish those at most this often. */
export const kirikiriSystemSyncDelayMs = 30_000;

export class KirikiriWriteOverlay {
  readonly writes = new Map<string, Uint8Array | null>();
  readonly sequences = new Map<string, number>();
  readonly progressPaths = new Set<string>();
  sequence = 0;
  lastWriteAt = 0;
  acknowledged = 0;
  /** Sequence of the last completed player bookmark; system bookmarks and files do not move it. */
  savePoint = 0;
  /** The game's own image of that save point, when the engine published one. */
  savePointImage: KirikiriSaveImage | null = null;
  private bytes = 0;
  private failure: Error | undefined;
  private readonly pending = new Map<number, PendingSave>();
  private readonly tainted = new Set<string>();
  /** Files as the last persisted capture held them; churn that returns to them is no change. */
  private baseline: ReadonlyMap<string, Uint8Array | null> = new Map();
  private baselineProgress = 0;
  private baselineSavePoint = 0;
  private readonly differing = new Set<string>();
  /** When the files first differed from the baseline; 0 while they match it. */
  private changedAt = 0;

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
    for (const call of this.pending.values()) {call.paths.add(normalized);}
    const previous = this.writes.get(normalized);
    if (data === null) {this.tainted.delete(normalized);}
    if (sameData(previous, data)) {return;}
    this.writes.set(normalized, data?.slice() ?? null);
    this.sequences.set(normalized, ++this.sequence);
    this.lastWriteAt = Date.now();
    this.bytes = size;
    this.compare(normalized);
    this.noteChange();
  }

  /** The current files, sharing the overlay's immutable copies. */
  snapshot(): KirikiriOverlaySnapshot {
    return {revision: this.sequence, writes: new Map(this.writes), progress: this.progressPaths.size, savePoint: this.savePoint};
  }

  acknowledge(snapshot: KirikiriOverlaySnapshot) {
    if (snapshot.revision < this.acknowledged) {return;}
    this.acknowledged = snapshot.revision;
    this.baseline = snapshot.writes;
    this.baselineProgress = snapshot.progress;
    this.baselineSavePoint = snapshot.savePoint;
    this.differing.clear();
    for (const path of this.writes.keys()) {this.compare(path);}
    this.changedAt = 0;
    this.noteChange();
  }

  requireValid() {if (this.failure) {throw this.failure;}}

  observe(event: {phase: "begin" | "end"; id: number; success?: boolean; history?: boolean}) {
    if (!Number.isSafeInteger(event.id) || event.id < 1) {this.invalid(); return;}
    if (event.phase === "begin") {
      if (this.pending.has(event.id) || this.pending.size >= 32 || typeof event.history !== "boolean") {this.invalid(); return;}
      this.pending.set(event.id, {paths: new Set(), history: event.history});
      return;
    }
    const call = this.pending.get(event.id);
    if (event.phase !== "end" || !call || typeof event.success !== "boolean") {this.invalid(); return;}
    this.pending.delete(event.id);
    if (event.success) {this.publish(call);}
    else {this.retainFailedWrites(call.paths);}
  }

  observeImage(event: {id: number; width: number; height: number; pixels: Uint8Array}) {
    const call = this.pending.get(event.id);
    const {width, height, pixels} = event;
    if (!call?.history || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || !isUint8Array(pixels) || pixels.byteLength !== width * height * 4) {
      this.invalid(); return;
    }
    call.image = {width, height, pixels};
  }

  seedProgress(paths: readonly string[]) {
    for (const path of paths) {this.progressPaths.add(path);}
    this.acknowledge(this.snapshot());
  }

  availability() {
    if (this.failure || this.pending.size || this.tainted.size) {return "NOT_READY";}
    if (!this.progressPaths.size) {return "NO_SAVE";}
    const unchanged = this.sequence === this.acknowledged ||
      !this.differing.size && this.progressPaths.size === this.baselineProgress;
    return unchanged ? "UNCHANGED" : null;
  }

  /** Whether any file differs from the last persisted or restored capture. */
  changed() {return this.sequence !== this.acknowledged && this.differing.size > 0;}

  /** Availability for background sync. A completed player bookmark is
   * published at once; changes to other files wait for the system delay. Final
   * snapshots use availability() and still include every change. */
  syncAvailability(now = Date.now()) {
    const availability = this.availability();
    if (availability !== null || this.savePoint !== this.baselineSavePoint) {return availability;}
    return now - this.changedAt < kirikiriSystemSyncDelayMs ? "UNCHANGED" : null;
  }

  private noteChange() {
    if (!this.changedAt && (this.differing.size || this.progressPaths.size !== this.baselineProgress)) {this.changedAt = Date.now();}
  }

  // Games commonly rewrite system files through temporary names and backups.
  // Only the resulting files are saved, so compare them, not the operations.
  private compare(path: string) {
    const current = this.writes.get(path);
    if (this.baseline.has(path) && sameData(this.baseline.get(path), current ?? null)) {this.differing.delete(path);}
    else {this.differing.add(path);}
  }

  private publish(call: PendingSave) {
    let changed = false, written = false;
    for (const path of call.paths) {
      this.tainted.delete(path);
      if ((this.writes.get(path)?.byteLength ?? 0) > 0) {
        written = true;
        if (!this.progressPaths.has(path)) {this.progressPaths.add(path); changed = true;}
      }
    }
    if (changed) {++this.sequence; this.lastWriteAt = Date.now(); this.noteChange();}
    if (written && call.history) {this.savePoint = this.sequence; this.savePointImage = call.image ?? null;}
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

export type KirikiriOverlaySnapshot = {
  revision: number; writes: ReadonlyMap<string, Uint8Array | null>; progress: number; savePoint: number;
};

type PendingSave = {paths: Set<string>; history: boolean; image?: KirikiriSaveImage};

// The core publishes from the game frame's realm.
function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function sameData(previous: Uint8Array | null | undefined, current: Uint8Array | null) {
  if (previous === null || current === null) {return previous === current;}
  return previous !== undefined && previous.byteLength === current.byteLength &&
    previous.every((value, i) => value === current[i]);
}
