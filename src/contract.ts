export type RuntimeState =
  | "CREATED"
  | "LOADING"
  | "RUNNING"
  | "PAUSED"
  | "CHECKPOINTING"
  | "EXITING"
  | "EXITED"
  | "FAILED";

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

export type RuntimeValidationProbe = {
  kind: string;
  schemaVersion: number;
  value: unknown;
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

export type RuntimeContentSourceKind = FileTreeSource["kind"] | SeekableBlobSource["kind"] |
  "ISOLATED_WEB" | "NATIVE_WEB" | "WASM4_CART";

export type RuntimeLoadPhase = "RUNTIME_ASSET" | "PROJECT_INDEX" | "PROJECT_CONTENT" | "RESTORE";

export type RuntimeLoadProgress = {
  phase: RuntimeLoadPhase;
  loadedBytes: number;
  totalBytes: number | null;
};

export type RuntimeVideoMode = "original" | "pixel" | "smooth" | "sharp-bilinear" | "adaptive-sharpen";

export type RuntimeCapabilities = {
  checkpoint: boolean;
  contentSources: readonly RuntimeContentSourceKind[];
  frameCounter: boolean;
  pause: boolean;
  screenshot: boolean;
  standardGamepad: boolean;
  validationProbes: readonly string[];
  volume: boolean;
};

export type GameRuntimeEvent =
  | { type: "READY" }
  | ({ type: "LOAD_PROGRESS" } & RuntimeLoadProgress)
  | { type: "STATE_CHANGED"; previous: RuntimeState; state: RuntimeState }
  | { type: "CHECKPOINT_AVAILABILITY_CHANGED"; availability: CheckpointAvailability }
  | { type: "FATAL_ERROR"; code: string }
  | { type: "EXIT_REQUESTED" };

export interface GameRuntime {
  mount(target: HTMLElement): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  checkpoint(): Promise<RuntimeCheckpoint>;
  screenshot(): Promise<Blob>;
  exit(): Promise<void>;
  getState(): RuntimeState;
  getCapabilities(): RuntimeCapabilities;
  getCheckpointAvailability(): CheckpointAvailability;
  getCanvas(): HTMLCanvasElement | null;
  getFrameCount(): number | null;
  getValidationProbe(kind: string): RuntimeValidationProbe | null;
  setVideoMode?(mode: RuntimeVideoMode): Promise<void>;
  setVolume(value: number): void;
  subscribe(listener: (event: GameRuntimeEvent) => void): () => void;
}
