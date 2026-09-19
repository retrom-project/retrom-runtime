import {abi, contractSha256} from "../content-io/identity.js";
import {contentLimits} from "../content-io/limits.js";
import {rangePolicy} from "../provider/content-policies.js";
import {fileContentSource, type AdapterContentOptions} from "../provider/content-inputs.js";
import type {PlayModule} from "./core.js";
import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import {loadPlay, validPlayCore, validPlayModule, type PlayLoader, type PlayParameters} from "./core.js";

export async function mountPlay(config: PlayParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, reportFailure: (error: Error) => void, signal?: AbortSignal,
  loader: PlayLoader = loadPlay, content?: AdapterContentOptions,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restorePayload &&
      (restorePayload.byteLength < 1 || restorePayload.byteLength > 268435456)) {throw new Error("PLAY_RUNTIME_CONFIG_INVALID");}
  signal?.throwIfAborted();
  const module = await loader(config, frameWindow, signal, content?.contentSession);
  if (!validPlayModule(module)) {throw new Error("PLAY_CORE_ABI_MISMATCH");}
  signal?.throwIfAborted();
  const {core, reader} = await startPlay(module, config, target, restorePayload, reportFailure, signal, content);
  let exited = false;
  const exit = async () => {
    if (exited) {return;}
    exited = true; signal?.removeEventListener("abort", abort);
    try {await core.stop();} finally {await reader.close();}
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

async function startPlay(module: PlayModule, config: PlayParameters, target: HTMLElement, restorePayload: Uint8Array | null,
  reportFailure: (error: Error) => void, signal?: AbortSignal, content?: AdapterContentOptions) {
  if (!content) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  const policy = rangePolicy("POLLING", contentLimits.indexedFile);
  const reader = await content.contentSession.open(fileContentSource(config.disc, policy), policy, signal);
  try {
    const core = await module.createRetromPlay({disc: {sha256: config.disc.sha256, sizeBytes: config.disc.sizeBytes},
      content: {abi, contractSha256, disc: reader}, restorePayload: restorePayload?.slice() ?? null, target, onFailure: reportFailure, signal});
    if (!validPlayCore(core)) {throw new Error("PLAY_CORE_ABI_MISMATCH");} return {core, reader};
  } catch (error) {await reader.close(); throw error;}
}
