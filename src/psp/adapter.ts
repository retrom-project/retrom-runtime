import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import {loadPSP, validPSPCore, validPSPModule, type PSPLoader, type PSPParameters} from "./core.js";

export async function mountPSP(config: PSPParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, _reportProgress: RuntimeProgressReporter, reportFailure: (error: Error) => void, signal?: AbortSignal,
  dependencies: {loader?: PSPLoader} = {},
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restorePayload &&
      (restorePayload.byteLength < 1 || restorePayload.byteLength > 268435456)) {throw new Error("PPSSPP_RUNTIME_CONFIG_INVALID");}
  signal?.throwIfAborted();
  const module = await (dependencies.loader ?? loadPSP)(config, frameWindow, signal);
  if (!validPSPModule(module)) {throw new Error("PPSSPP_CORE_ABI_MISMATCH");}
  signal?.throwIfAborted();
  const source = {...config.game, url: new URL(config.game.url, window.location.href).href};
  const core = await module.createPPSSPPHost({source, restore: restorePayload?.slice() ?? null,
    target, onFailure: reportFailure, signal});
  if (!validPSPCore(core)) {throw new Error("PPSSPP_CORE_ABI_MISMATCH");}
  let exited = false;
  const exit = async () => {
    if (exited) {return;}
    exited = true; signal?.removeEventListener("abort", abort); await core.stop();
  };
  const abort = () => {void exit();};
  if (signal?.aborted) {await exit(); signal.throwIfAborted();}
  signal?.addEventListener("abort", abort, {once: true});
  const requireActive = () => {if (exited) {throw new Error("PPSSPP_RUNTIME_EXITED");}};
  return {
    checkpoint: async () => {
      requireActive();
      const value = await core.checkpoint();
      requireActive();
      if (!ArrayBuffer.isView(value) || value.byteLength < 1 || value.byteLength > 268435456) {
        throw new Error("PPSSPP_CHECKPOINT_INVALID");
      }
      const bytes = new Uint8Array(value.byteLength); bytes.set(value);
      return {bytes, format: "ppsspp-state-v1"};
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
    setVolume: value => {requireActive(); core.setVolume(value);},
  };
}
