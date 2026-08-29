export type MountedKirikiriAdapter = {
  checkpoint(): Promise<Uint8Array>;
  exit(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
};
