import type {
  CheckpointAvailability,
  RuntimeCheckpoint,
  RuntimeLoadProgress,
  RuntimeValidationProbe,
} from "./contract.js";
import type {RuntimeVideoModeV1} from "./provider/module-api.js";

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
  setVideoMode?: (mode: RuntimeVideoModeV1) => Promise<void>;
  setVolume: ((value: number) => void) | null;
};

export type RuntimeProgressReporter = (progress: RuntimeLoadProgress) => void;
export type RuntimeExitReporter = () => void;
