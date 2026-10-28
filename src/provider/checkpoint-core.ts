import type {MountedRuntimeAdapter} from "../internal-adapter.js";

type CheckpointCore = {
  canvas: HTMLCanvasElement;
  checkpoint(): Promise<Uint8Array>;
  frameCount(): number;
  pause(): Promise<void>;
  resume(): Promise<void>;
  screenshot(): Promise<Blob>;
  stop(): Promise<void>;
};

/** Own a native checkpoint core, its content reader, and the loaded module as one session. */
export async function mountCheckpointCore<T extends CheckpointCore>(options: {
  start: () => Promise<{core: T; reader: {close(): Promise<void>}}>;
  closeModule: () => void;
  checkpointFormat: string;
  errorPrefix: string;
  signal?: AbortSignal;
  touchGamepad?: MountedRuntimeAdapter["touchGamepad"];
  setVolume?: (core: T, value: number) => void;
}): Promise<MountedRuntimeAdapter> {
  let started: Awaited<ReturnType<typeof options.start>>;
  try {started = await options.start();}
  catch (error) {options.closeModule(); throw error;}
  const {core, reader} = started;
  let exited = false;
  const exit = async () => {
    if (exited) {return;}
    exited = true; options.signal?.removeEventListener("abort", abort);
    try {await core.stop();} finally {try {await reader.close();} finally {options.closeModule();}}
  };
  const abort = () => {void exit();};
  if (options.signal?.aborted) {await exit(); options.signal.throwIfAborted();}
  options.signal?.addEventListener("abort", abort, {once: true});
  const requireActive = () => {if (exited) {throw new Error(`${options.errorPrefix}_RUNTIME_EXITED`);}};
  const setVolume = options.setVolume;
  return {
    ...(options.touchGamepad ? {touchGamepad: options.touchGamepad} : {}),
    checkpoint: async () => {
      requireActive();
      const value = await core.checkpoint();
      requireActive();
      if (!ArrayBuffer.isView(value) || value.byteLength < 1 || value.byteLength > 268435456) {
        throw new Error(`${options.errorPrefix}_CHECKPOINT_INVALID`);
      }
      const bytes = new Uint8Array(value.byteLength); bytes.set(value);
      return {bytes, format: options.checkpointFormat};
    },
    exit,
    getCanvas: () => exited ? null : core.canvas,
    getFrameCount: () => exited ? null : core.frameCount(),
    getCheckpointAvailability: () => exited ? {available: false, blocker: "NOT_READY"} : {available: true, blocker: null},
    pause: async () => {requireActive(); await core.pause();},
    resume: async () => {requireActive(); await core.resume();},
    screenshot: async () => {
      requireActive();
      const blob = await core.screenshot();
      return new Blob([await blob.arrayBuffer()], {type: blob.type});
    },
    setVolume: setVolume ? value => {requireActive(); setVolume(core, value);} : null,
  };
}
