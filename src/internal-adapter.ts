import type {
  CheckpointAvailability,
  CheckpointRequest,
  RuntimeCheckpoint,
  RuntimeLoadProgress,
} from "./contract.js";
import type {RuntimeVideoModeV1, RuntimeInputDiagnosticsV1} from "./provider/module-api.js";

export type MountedRuntimeAdapter = {
  /** CORE owns responsive canvas sizing; otherwise the Provider fits a fixed-resolution canvas. */
  canvasLayout?: "CORE";
  checkpoint(request?: CheckpointRequest): Promise<RuntimeCheckpoint>;
  acknowledgeCheckpoint?(checkpoint: RuntimeCheckpoint): Promise<void>;
  exit(): Promise<void>;
  getCanvas(): HTMLCanvasElement | null;
  getCheckpointAvailability(): CheckpointAvailability;
  getFrameCount(): number | null;
  startInputDiagnostics?(): RuntimeInputDiagnosticsV1;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  setVideoMode?: (mode: RuntimeVideoModeV1) => Promise<void>;
  setVolume: ((value: number) => void) | null;
};

export type RuntimeProgressReporter = (progress: RuntimeLoadProgress) => void;
export type RuntimeExitSnapshot = {checkpoint: RuntimeCheckpoint; screenshot: Blob | null};
export type RuntimeExitReporter = (finalSnapshot?: RuntimeExitSnapshot) => void;
