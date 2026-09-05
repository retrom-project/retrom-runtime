export type CheckpointBlocker =
  | "NOT_READY"
  | "BUSY"
  | "SAVE_DISABLED"
  | "UNSUPPORTED"
  | "FAILED"
  | "ALREADY_CREATED"
  | "MODE_UNSUPPORTED";

export type CheckpointAvailability =
  | { available: true; blocker: null }
  | { available: false; blocker: CheckpointBlocker };

export type RuntimeCheckpoint = {
  bytes: Uint8Array;
  format: string;
};

export type FileTreeSource = {
  kind: "FILE_TREE";
  indexUrl: string;
};

export type SeekableBlobSource = {
  kind: "SEEKABLE_BLOB";
  rangeRequired: true;
  sha256: string;
  sizeBytes: number;
  url: string;
};

export type RuntimeLoadPhase = "RUNTIME_ASSET" | "PROJECT_INDEX" | "PROJECT_CONTENT" | "RESTORE";

export type RuntimeLoadProgress = {
  phase: RuntimeLoadPhase;
  loadedBytes: number;
  totalBytes: number | null;
};
