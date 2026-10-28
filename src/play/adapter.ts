import {mountCheckpointCore} from "../provider/checkpoint-core.js";
import {abi, contractSha256} from "../content-io/identity.js";
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
  const loaded = await loader(config, frameWindow, signal, content?.contentSession, content?.reportProgress);
  return mountCheckpointCore({
    start: async () => {
      if (!validPlayModule(loaded.module)) {throw new Error("PLAY_CORE_ABI_MISMATCH");}
      signal?.throwIfAborted();
      return startPlay(loaded.module, loaded.assets, config, target, restorePayload, reportFailure, signal, content);
    },
    closeModule: () => loaded.close(), checkpointFormat: "play-state-v1", errorPrefix: "PLAY", signal,
  });
}

async function startPlay(module: PlayModule, assets: Readonly<Record<string, string>>, config: PlayParameters, target: HTMLElement, restorePayload: Uint8Array | null,
  reportFailure: (error: Error) => void, signal?: AbortSignal, content?: AdapterContentOptions) {
  if (!content) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  const policy = content.contentSession.inputPolicy("game");
  const reader = await content.contentSession.open(fileContentSource(config.disc, policy), policy, signal);
  try {
    const core = await module.createRetromPlay({disc: {sha256: config.disc.sha256, sizeBytes: config.disc.sizeBytes},
      content: {abi, contractSha256, disc: reader}, assets, restorePayload: restorePayload?.slice() ?? null, target, onFailure: reportFailure, signal});
    if (!validPlayCore(core)) {throw new Error("PLAY_CORE_ABI_MISMATCH");} return {core, reader};
  } catch (error) {await reader.close(); throw error;}
}
