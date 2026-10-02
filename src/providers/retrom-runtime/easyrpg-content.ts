import type {AdapterContentSession} from "../../provider/content-inputs.js";
import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import type {MountedRuntimeAdapter} from "../../internal-adapter.js";
import {resourceSources} from "../../provider/preload-sources.js";
import {installContentXHR} from "../../easyrpg/content-xhr.js";

export async function mountWithEasyRpgContent(envelope: LaunchEnvelopeV1, frame: Window,
  session: AdapterContentSession, signal: AbortSignal, mount: () => Promise<MountedRuntimeAdapter>) {
  const files = new Map();
  for (const resource of envelope.resources) {
    if (resource.kind !== "FILE_TREE" || !["game", "rtp"].includes(resource.role)) {continue;}
    const policy = session.inputPolicy(resource.role);
    for (const source of await resourceSources(resource, policy, signal)) {files.set(source.url, {source, policy});}
  }
  signal.throwIfAborted();
  const cleanup = installContentXHR(frame, files, session, signal);
  try {
    const adapter = await mount();
    return {...adapter, exit: async () => {try {await adapter.exit();} finally {cleanup();}}};
  } catch (error) {cleanup(); throw error;}
}
