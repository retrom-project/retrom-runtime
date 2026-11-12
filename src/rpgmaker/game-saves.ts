import {sha256} from "@noble/hashes/sha2.js";
import {decodeRpgCheckpoint, encodeRpgCheckpoint, rpgSaveEntryOrder, type RpgCheckpointBundle, type RpgCheckpointEngine, type RpgCheckpointEntry} from "../checkpoint.js";
import type {CheckpointAvailability, RuntimeCheckpoint} from "../contract.js";

export const inGameSave = {capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false} as const;

/** Tracks the exact exported native bytes; acknowledging an earlier export cannot hide later writes. */
export class RpgGameSaves {
  private baseline: string;
  private baselineEntries: RpgCheckpointEntry[];
  constructor(private readonly engine: RpgCheckpointEngine, private readonly read: () => RpgCheckpointEntry[],
    restored: RpgCheckpointBundle | null, private readonly isProgress: (entry: RpgCheckpointEntry) => boolean = () => true) {
    this.baseline = signature(restored?.entries ?? []);
    this.baselineEntries = copyEntries(restored?.entries ?? []);
  }
  availability(): CheckpointAvailability {
    const entries = this.read();
    const save = {...inGameSave, dataKind: entries.some(this.isProgress) ? "PROGRESS" : "STORAGE"} as const;
    if (!entries.length) {return {available: false, blocker: "NO_SAVE", save};}
    const revision = signature(entries);
    return revision === this.baseline ? {available: false, blocker: "UNCHANGED", save} : {available: true, blocker: null, revision, save};
  }
  async capture(): Promise<Omit<RuntimeCheckpoint, "format">> {
    const entries = this.read();
    if (!entries.length || signature(entries) === this.baseline) {throw new Error("RPG_GAME_SAVE_UNAVAILABLE");}
    const unchanged = signature(entries.filter(this.isProgress)) === signature(this.baselineEntries.filter(this.isProgress));
    return {bytes: await encodeRpgCheckpoint({engine: this.engine, entries}),
      ...(unchanged ? {screenshot: "UNCHANGED" as const} : {})};
  }
  async acknowledge(bytes: Uint8Array) {
    const bundle = await decodeRpgCheckpoint(bytes, this.engine);
    this.acknowledgeBundle(bundle);
  }
  acknowledgeBundle(bundle: RpgCheckpointBundle) {
    if (bundle.engine !== this.engine) {throw new Error("RPG_GAME_SAVE_INVALID");}
    this.baseline = signature(bundle.entries);
    this.baselineEntries = copyEntries(bundle.entries);
  }
}

function copyEntries(entries: RpgCheckpointEntry[]) {
  return entries.map(entry => ({...entry, data: entry.data.slice()}));
}

function signature(entries: RpgCheckpointEntry[]) {
  const hash = sha256.create(), encoder = new TextEncoder();
  for (const entry of [...entries].sort(rpgSaveEntryOrder)) {
    hash.update(encoder.encode(JSON.stringify([entry.store, entry.key, entry.data.byteLength])));
    hash.update(entry.data);
  }
  return [...hash.digest()].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
