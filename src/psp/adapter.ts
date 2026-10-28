import {mountCheckpointCore} from "../provider/checkpoint-core.js";
import {startPSP} from "./start.js";
import type {PSPContentOptions, PSPCore} from "./core.js";
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
  let core: PSPCore | undefined;
  const format = "ppsspp-game-save-v1";
  const save = {dataKind: "PROGRESS", capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false} as const;
  const session = await mountCheckpointCore({
    start: async () => {
      if (!validPSPModule(loaded.module)) {throw new Error("PPSSPP_CORE_ABI_MISMATCH");}
      signal?.throwIfAborted();
      const {instance, reader} = await startPSP(loaded.module, loaded.assets, config, target, restorePayload, reportFailure, signal, content);
      core = instance;
      return {core: instance, reader};
    },
    closeModule: () => loaded.close(), checkpointFormat: format, errorPrefix: "PPSSPP", signal,
    touchGamepad: {layout: "PSP"}, setVolume: (core, value) => core.setVolume(value),
  });
  const active = () => {
    if (!session.getCanvas() || !core) {throw new Error("PPSSPP_RUNTIME_EXITED");}
    return core;
  };
  return {
    ...session,
    getCheckpointAvailability: () => ({...(session.getCanvas() && core ? core.getCheckpointAvailability() :
      {available: false, blocker: "NOT_READY" as const}), save}),
    checkpoint: async request => {
      if (request?.intent === "CAPTURE") {throw new Error("PPSSPP_SAVE_UNAVAILABLE");}
      return session.checkpoint();
    },
    acknowledgeCheckpoint: async checkpoint => {
      const instance = active();
      if (checkpoint.format !== format || !checkpoint.bytes.length || checkpoint.bytes.length > 268435456) {
        throw new Error("PPSSPP_CHECKPOINT_INVALID");
      }
      await instance.acknowledgeCheckpoint(checkpoint.bytes.slice());
      active();
    },
  };
}
