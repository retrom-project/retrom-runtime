import {startPSP} from "./start.js";
import type {PSPContentOptions} from "./core.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import {loadPSP, validPSPModule, type PSPLoader, type PSPParameters} from "./core.js";

export async function mountPSP(config: PSPParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, _reportProgress: RuntimeProgressReporter, reportFailure: (error: Error) => void, signal?: AbortSignal,
  dependencies: {loader?: PSPLoader} = {}, content?: PSPContentOptions,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restorePayload &&
      (restorePayload.byteLength < 1 || restorePayload.byteLength > 268435456)) {throw new Error("PPSSPP_RUNTIME_CONFIG_INVALID");}
  signal?.throwIfAborted();
  const module = await (dependencies.loader ?? loadPSP)(config, frameWindow, signal, content?.contentSession);
  if (!validPSPModule(module)) {throw new Error("PPSSPP_CORE_ABI_MISMATCH");}
  signal?.throwIfAborted();
  const {instance, reader} = await startPSP(module, config, target, restorePayload, reportFailure, signal, content);
  let exited = false;
  const exit = async () => {
    if (exited) {return;}
    exited = true; signal?.removeEventListener("abort", abort);
    try {await instance.stop();} finally {await reader.close();}
  };
  const abort = () => {void exit();};
  if (signal?.aborted) {await exit(); signal.throwIfAborted();}
  signal?.addEventListener("abort", abort, {once: true});
  const requireActive = () => {if (exited) {throw new Error("PPSSPP_RUNTIME_EXITED");}};
  return {
    checkpoint: async () => {
      requireActive();
      const value = await instance.checkpoint();
      requireActive();
      if (!ArrayBuffer.isView(value) || value.byteLength < 1 || value.byteLength > 268435456) {
        throw new Error("PPSSPP_CHECKPOINT_INVALID");
      }
      const bytes = new Uint8Array(value.byteLength); bytes.set(value);
      return {bytes, format: "ppsspp-state-v1"};
    },
    exit,
    getCanvas: () => exited ? null : instance.canvas,
    getFrameCount: () => exited ? null : instance.frameCount(),
    getCheckpointAvailability: () => exited ? {available: false, blocker: "NOT_READY"} : {available: true, blocker: null},
    pause: async () => {requireActive(); await instance.pause();},
    resume: async () => {requireActive(); await instance.resume();},
    screenshot: async () => {
      requireActive();
      const blob = await instance.screenshot();
      return new Blob([await blob.arrayBuffer()], {type: blob.type});
    },
    setVolume: value => {requireActive(); instance.setVolume(value);},
  };
}
