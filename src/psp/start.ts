import {verifiedContentAsset} from "../content-io/bootstrap.js";
import {abi, contractSha256} from "../content-io/identity.js";
import {fileContentSource} from "../provider/content-inputs.js";
import {validPSPCore, type PSPModule, type PSPParameters, type PSPContentOptions} from "./core.js";
export async function startPSP(module: PSPModule, assets: Readonly<Record<string, string>>, config: PSPParameters, target: HTMLElement,
  restorePayload: Uint8Array | null, reportFailure: (error: Error) => void, signal?: AbortSignal, content?: PSPContentOptions) {
  if (!content || !config.assetIndex) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  const session = content.contentSession, policy = session.inputPolicy("game");
  const reader = await session.open(fileContentSource(config.game, policy), policy, signal);
  let core: unknown, syncClientUrl: string | undefined;
  try {
    const channel = await session.createSyncChannel(reader.id);
    const blob = await verifiedContentAsset(new URL(content.runtimeBaseURL, location.href).href, config.assetIndex, "sync-client.mjs", signal);
    syncClientUrl = URL.createObjectURL(blob);
    core = await module.createPPSSPPHost({source: {sha256: config.game.sha256, sizeBytes: config.game.sizeBytes},
      content: {...channel, abi, contractSha256, syncClientUrl}, restore: restorePayload?.slice() ?? null,
      target, assets, onFailure: reportFailure, signal});
    if (!validPSPCore(core)) {throw new Error("PPSSPP_CORE_ABI_MISMATCH");}
  } catch (error) {await reader.close(); throw error;}
  finally {if (syncClientUrl) {URL.revokeObjectURL(syncClientUrl);}}
  if (!validPSPCore(core)) {throw new Error("PPSSPP_CORE_ABI_MISMATCH");}
  return {instance: core, reader};
}
