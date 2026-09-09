import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import {loadPlay, validPlayCore, validPlayModule, type PlayLoader, type PlayParameters} from "./core.js";

export async function mountPlay(config: PlayParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, reportFailure: (error: Error) => void, signal?: AbortSignal,
  loader: PlayLoader = loadPlay,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restorePayload &&
      (restorePayload.byteLength < 1 || restorePayload.byteLength > 268435456)) {throw new Error("PLAY_RUNTIME_CONFIG_INVALID");}
  signal?.throwIfAborted();
  const module = await loader(config, frameWindow, signal);
  if (!validPlayModule(module)) {throw new Error("PLAY_CORE_ABI_MISMATCH");}
  signal?.throwIfAborted();
  const core = await module.createRetromPlay({disc: config.disc, restorePayload: restorePayload?.slice() ?? null,
    target, onFailure: reportFailure, signal});
  if (!validPlayCore(core)) {throw new Error("PLAY_CORE_ABI_MISMATCH");}
  let exited = false;
  const exit = async () => {
    if (exited) {return;}
    exited = true; signal?.removeEventListener("abort", abort); await core.stop();
  };
  const abort = () => {void exit();};
  if (signal?.aborted) {await exit(); signal.throwIfAborted();}
  signal?.addEventListener("abort", abort, {once: true});
  const requireActive = () => {if (exited) {throw new Error("PLAY_RUNTIME_EXITED");}};
  return {
    checkpoint: async () => {
      requireActive();
      const value = await core.checkpoint();
      requireActive();
      if (!ArrayBuffer.isView(value) || value.byteLength < 1 || value.byteLength > 268435456) {
        throw new Error("PLAY_CHECKPOINT_INVALID");
      }
      const bytes = new Uint8Array(value.byteLength); bytes.set(value);
      return {bytes, format: "play-state-v1"};
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
    setVolume: null,
  };
}
