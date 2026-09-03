import type {
  CheckpointAvailability,
  RuntimeCheckpoint,
  RuntimeLoadProgress,
  RuntimeVideoMode,
  RuntimeValidationProbe,
} from "./contract.js";

export type MountedRuntimeAdapter = {
  checkpoint(): Promise<RuntimeCheckpoint>;
  exit(): Promise<void>;
  getCanvas(): HTMLCanvasElement | null;
  getCheckpointAvailability(): CheckpointAvailability;
  getFrameCount(): number | null;
  getValidationProbe(kind: string): RuntimeValidationProbe | null;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  setVideoMode?: (mode: RuntimeVideoMode) => Promise<void>;
  setVolume: ((value: number) => void) | null;
};

export type RuntimeProgressReporter = (progress: RuntimeLoadProgress) => void;
export type RuntimeExitReporter = () => void;

export type RuntimeAdapterMount = (
  target: HTMLElement,
  reportProgress: RuntimeProgressReporter,
  reportExitRequested: RuntimeExitReporter,
) => Promise<MountedRuntimeAdapter>;
