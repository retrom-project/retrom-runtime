export type CheckpointBlocker =
  | "NOT_READY"
  | "BUSY"
  | "SAVE_DISABLED"
  | "NO_SAVE"
  | "UNCHANGED"
  | "UNSUPPORTED"
  | "FAILED"
  | "ALREADY_CREATED"
  | "MODE_UNSUPPORTED";

export type NativeSaveCapabilities = {
  dataKind?: "PROGRESS" | "STORAGE";
  capture: "RUNTIME" | "IN_GAME";
  restore: "AUTOMATIC" | "IN_GAME";
  captureAvailable: boolean;
};

export type CheckpointRequest = {intent: "CAPTURE" | "EXPORT"};

export type CheckpointAvailability = (
  | { available: true; blocker: null; revision?: string }
  | { available: false; blocker: CheckpointBlocker }
) & {save?: NativeSaveCapabilities};

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
