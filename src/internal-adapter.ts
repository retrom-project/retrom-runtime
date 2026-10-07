import type {
  CheckpointAvailability,
  CheckpointRequest,
  RuntimeCheckpoint,
  RuntimeLoadProgress,
} from "./contract.js";
import type {RuntimeVideoModeV1, RuntimeInputDiagnosticsV1, RuntimeGameEditorV1, RuntimeInputFilterPolicyV1} from "./provider/module-api.js";

import type {GamepadCursor} from "./provider/gamepad-cursor.js";

export type MountedRuntimeAdapter = {
  gamepadCursor?: GamepadCursor;
  /** CORE owns responsive canvas sizing; otherwise the Provider fits a fixed-resolution canvas. */
  canvasLayout?: "CORE";
  checkpoint(request?: CheckpointRequest): Promise<RuntimeCheckpoint>;
  acknowledgeCheckpoint?(checkpoint: RuntimeCheckpoint): Promise<void>;
  exit(): Promise<void>;
  getCanvas(): HTMLCanvasElement | null;
  /** Display ratio may differ from frame-buffer dimensions for non-square pixels. */
  getDisplayAspectRatio?(): number;
  getCheckpointAvailability(): CheckpointAvailability;
  getFrameCount(): number | null;
  startInputDiagnostics?(): RuntimeInputDiagnosticsV1;
  /** Isolated adapters deliver policy to their own realm through the control channel. */
  setInputFilter?(policy: RuntimeInputFilterPolicyV1 | null): Promise<void>;
  gameEditor?: RuntimeGameEditorV1;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  setVideoMode?: (mode: RuntimeVideoModeV1) => Promise<void>;
  setVolume: ((value: number) => void) | null;
};

export type RuntimeProgressReporter = (progress: RuntimeLoadProgress) => void;
export type RuntimeExitSnapshot = {checkpoint: RuntimeCheckpoint; screenshot: Blob | null};
export type RuntimeExitReporter = (finalSnapshot?: RuntimeExitSnapshot) => void;
