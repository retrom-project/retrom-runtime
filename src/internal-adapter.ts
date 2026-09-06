import type {
  CheckpointAvailability,
  RuntimeCheckpoint,
  RuntimeLoadProgress,
} from "./contract.js";
import type {RuntimeVideoModeV1} from "./provider/module-api.js";

export type MountedRuntimeAdapter = {
  checkpoint(): Promise<RuntimeCheckpoint>;
  acknowledgeCheckpoint?(checkpoint: RuntimeCheckpoint): Promise<void>;
  exit(): Promise<void>;
  getCanvas(): HTMLCanvasElement | null;
  getCheckpointAvailability(): CheckpointAvailability;
  getFrameCount(): number | null;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  setVideoMode?: (mode: RuntimeVideoModeV1) => Promise<void>;
  setVolume: ((value: number) => void) | null;
};

export type RuntimeProgressReporter = (progress: RuntimeLoadProgress) => void;
export type RuntimeExitReporter = () => void;
