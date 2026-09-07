import type {CheckpointAvailability, CheckpointRequest, RuntimeCheckpoint} from "../contract.js";
import {encodeScummvmSave, maximumSaveBytes, saveDigest, scummvmSaveFormat, type SaveFile} from "./checkpoint.js";

export type SaveFs = {
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  stat(path: string): {size: number; mode: number};
  isDir(mode: number): boolean;
};
export type NativeStatus = {capture: boolean; available: boolean; automatic: boolean};
type Snapshot = {
  generation: number;
  content: string | null;
  revision: string | null;
  slot: number | null;
  checkpoint: RuntimeCheckpoint | null;
};
type Pending = {
  capture: boolean;
  resolve(checkpoint: RuntimeCheckpoint): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Commands are consumed by C++ at its event boundary, never by reentrant WASM exports. */
export class ScummvmBridge {
  command = 0;
  paused = false;
  private fs: SaveFs | null = null;
  private status: NativeStatus = {capture: false, available: false, automatic: false};
  private running = true;
  private writes = 0;
  private generation = 0;
  private acknowledged: {generation: number; revision: string | null} = {generation: 0, revision: null};
  private snapshot: Snapshot = {generation: 0, content: null, revision: null, slot: null, checkpoint: null};
  private slotHint: {generation: number; slot: number | null} | null = null;
  private refreshing: Promise<void> | null = null;
  private invalid = false;
  private finalized = false;
  private pending: Pending | null = null;
  private readonly exported = new Map<string, number>();

  constructor(private readonly identity: string) {}
  attach(fs: SaveFs) {this.fs = fs;}
  async restoreBaseline(resumeSlot: number | null) {
    this.generation++;
    this.slotHint = {generation: this.generation, slot: resumeSlot};
    this.snapshot = await this.encode(this.copyFiles(), this.generation);
    this.acknowledged = {generation: this.generation, revision: this.snapshot.revision};
    this.slotHint = null;
  }
  onStatus(status: NativeStatus) {this.status = status;}
  onWrite(open: boolean) {
    this.writes += open ? 1 : -1;
    if (!open) {this.generation++; this.invalid = false;}
  }
  onSaveResult(slot: number, error: number) {
    if (!this.pending?.capture) {return;}
    if (error || !Number.isInteger(slot) || slot < 0 || slot > 9999) {this.reject("SCUMMVM_SAVE_FAILED"); return;}
    this.slotHint = {generation: this.generation, slot: this.status.automatic ? slot : null};
    this.pending.capture = false;
  }
  onBoundary(): Promise<void> | undefined {
    if (!this.running || this.pending?.capture || this.writes || this.invalid) {return;}
    if (this.refreshing) {return this.refreshing;}
    if (this.snapshot.generation === this.generation && !this.slotHint) {this.finishPending(); return;}
    // Freeze bytes while C++ has no open native streams. The engine can keep running during hashing.
    try {
      const files = this.copyFiles();
      this.refreshing = this.encode(files, this.generation).then((snapshot) => {
        this.refreshing = null;
        if (!this.running) {return;}
        this.snapshot = snapshot;
        if (this.slotHint?.generation === snapshot.generation) {this.slotHint = null;}
        if (snapshot.generation === this.generation && !this.writes) {this.finishPending();}
      }, () => {this.refreshing = null; this.invalid = true; this.reject("SCUMMVM_SAVE_INVALID");});
      return this.refreshing;
    } catch {this.invalid = true; this.reject("SCUMMVM_SAVE_INVALID");}
  }

  async checkpoint(request: CheckpointRequest = {intent: "CAPTURE"}): Promise<RuntimeCheckpoint> {
    if (!this.running) {throw new Error("SCUMMVM_RUNTIME_STOPPED");}
    if (this.pending) {throw new Error("SCUMMVM_SAVE_BUSY");}
    if (this.invalid) {throw new Error("SCUMMVM_SAVE_INVALID");}
    const capture = request.intent === "CAPTURE";
    if (capture && (!this.status.capture || !this.status.available)) {throw new Error("SCUMMVM_SAVE_DISABLED");}
    if (!capture && !this.generation) {throw new Error("SCUMMVM_NO_SAVE");}
    return new Promise((resolve, reject) => {
      this.pending = {capture, resolve, reject,
        timer: setTimeout(() => this.reject("SCUMMVM_SAVE_TIMEOUT"), 20_000)};
      if (capture) {this.command = 1;}
    });
  }

  getAvailability(): CheckpointAvailability {
    const save = {capture: this.status.capture ? "RUNTIME" as const : "IN_GAME" as const,
      restore: this.status.automatic && (!this.snapshot.checkpoint || this.snapshot.slot !== null) ? "AUTOMATIC" as const : "IN_GAME" as const,
      captureAvailable: this.running && this.status.capture && this.status.available && !this.pending && !this.writes && !this.invalid};
    if (!this.running) {return {available: false, blocker: "NOT_READY", save: {...save, captureAvailable: false}};}
    if (this.invalid) {return {available: false, blocker: "FAILED", save};}
    if (this.pending || this.writes || this.snapshot.generation !== this.generation) {return {available: false, blocker: "BUSY", save};}
    if (!this.snapshot.revision) {return {available: false, blocker: "NO_SAVE", save};}
    if (this.snapshot.revision === this.acknowledged.revision) {return {available: false, blocker: "UNCHANGED", save};}
    return {available: true, blocker: null, revision: this.snapshot.revision, save};
  }

  async acknowledge(checkpoint: RuntimeCheckpoint) {
    if (checkpoint.format !== scummvmSaveFormat) {throw new Error("SCUMMVM_SAVE_INVALID");}
    const revision = await saveDigest(checkpoint.bytes);
    const generation = this.exported.get(revision);
    if (generation === undefined) {throw new Error("SCUMMVM_SAVE_INVALID");}
    if (generation >= this.acknowledged.generation) {this.acknowledged = {generation, revision};}
  }

  beginStop() {
    this.running = false;
    this.reject("SCUMMVM_RUNTIME_STOPPED");
  }
  stop(): Promise<RuntimeCheckpoint | null> {
    if (this.finalized) {return Promise.resolve(null);}
    this.finalized = true;
    this.beginStop();
    if (this.writes) {return Promise.reject(new Error("SCUMMVM_SAVE_BUSY"));}
    try {
      return this.encode(this.copyFiles(), this.generation).then((snapshot) =>
        snapshot.revision === this.acknowledged.revision ? null : this.export(snapshot));
    } catch {return Promise.reject(new Error("SCUMMVM_SAVE_INVALID"));}
  }

  private copyFiles(): SaveFile[] {
    if (!this.fs) {throw new Error("SCUMMVM_RUNTIME_STOPPED");}
    let total = 0;
    const files: SaveFile[] = [];
    for (const name of this.fs.readdir("/saves")) {
      if (name === "." || name === "..") {continue;}
      const path = `/saves/${name}`;
      const stat = this.fs.stat(path);
      if (this.fs.isDir(stat.mode) || !Number.isSafeInteger(stat.size) || stat.size < 0 ||
        stat.size > maximumSaveBytes - total || files.length >= 1024) {throw new Error("SCUMMVM_SAVE_INVALID");}
      const data = this.fs.readFile(path).slice();
      if (data.byteLength !== stat.size) {throw new Error("SCUMMVM_SAVE_INVALID");}
      total += stat.size;
      files.push({path: name, data});
    }
    return files;
  }

  private async encode(files: SaveFile[], generation: number): Promise<Snapshot> {
    if (!files.some((file) => file.data.byteLength)) {
      return {generation, content: null, revision: null, slot: null, checkpoint: null};
    }
    const hint = this.slotHint?.generation === generation ? this.slotHint : null;
    const previous = this.snapshot;
    const raw = await encodeScummvmSave({identity: this.identity, files, resumeSlot: null});
    const content = await saveDigest(raw);
    const slot = hint ? hint.slot : content === previous.content ? previous.slot : null;
    const bytes = slot === null ? raw : await encodeScummvmSave({identity: this.identity, files, resumeSlot: slot});
    return {generation, content, slot, revision: slot === null ? content : await saveDigest(bytes),
      checkpoint: {format: scummvmSaveFormat, bytes}};
  }
  private export(snapshot: Snapshot): RuntimeCheckpoint | null {
    if (!snapshot.checkpoint || !snapshot.revision) {return null;}
    this.exported.set(snapshot.revision, snapshot.generation);
    if (this.exported.size > 64) {this.exported.delete(this.exported.keys().next().value!);}
    return {...snapshot.checkpoint, bytes: snapshot.checkpoint.bytes.slice()};
  }
  private finishPending() {
    if (!this.pending || this.pending.capture) {return;}
    const checkpoint = this.export(this.snapshot);
    if (!checkpoint) {this.reject("SCUMMVM_NO_SAVE"); return;}
    const pending = this.pending; this.clearPending(); pending.resolve(checkpoint);
  }
  private clearPending() {if (this.pending) {clearTimeout(this.pending.timer); this.pending = null;}}
  private reject(code: string) {this.pending?.reject(new Error(code)); this.clearPending();}
}
