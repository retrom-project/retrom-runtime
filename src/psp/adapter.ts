import {mountCheckpointCore} from "../provider/checkpoint-core.js";
import {startPSP} from "./start.js";
import type {PSPContentOptions} from "./core.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import {loadPSP, validPSPModule, type PSPLoader, type PSPParameters} from "./core.js";

export async function mountPSP(config: PSPParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, reportProgress: RuntimeProgressReporter, reportFailure: (error: Error) => void, signal?: AbortSignal,
  dependencies: {loader?: PSPLoader} = {}, content?: PSPContentOptions,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restorePayload &&
      (restorePayload.byteLength < 1 || restorePayload.byteLength > 268435456)) {throw new Error("PPSSPP_RUNTIME_CONFIG_INVALID");}
  signal?.throwIfAborted();
  const loaded = await (dependencies.loader ?? loadPSP)(config, frameWindow, signal, content?.contentSession, reportProgress);
  return mountCheckpointCore({
    start: async () => {
      if (!validPSPModule(loaded.module)) {throw new Error("PPSSPP_CORE_ABI_MISMATCH");}
      signal?.throwIfAborted();
      const {instance, reader} = await startPSP(loaded.module, loaded.assets, config, target, restorePayload, reportFailure, signal, content);
      return {core: instance, reader};
    },
    closeModule: () => loaded.close(), checkpointFormat: "ppsspp-state-v1", errorPrefix: "PPSSPP", signal,
    touchGamepad: {layout: "PSP"}, setVolume: (core, value) => core.setVolume(value),
  });
}
