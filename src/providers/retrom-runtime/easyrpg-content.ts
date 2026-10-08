import type {AdapterContentSession} from "../../provider/content-inputs.js";
import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import type {MountedRuntimeAdapter} from "../../internal-adapter.js";
import {resourceSources} from "../../provider/preload-sources.js";
import {installContentXHR, type IndexedContent} from "../../easyrpg/content-xhr.js";
import {easyRpgProjectIndex} from "../../easyrpg/project-index.js";

export async function mountWithEasyRpgContent(envelope: LaunchEnvelopeV1, frame: Window,
  session: AdapterContentSession, signal: AbortSignal, mount: () => Promise<MountedRuntimeAdapter>) {
  const files = new Map<string, IndexedContent>();
  for (const resource of envelope.resources) {
    if (resource.kind !== "FILE_TREE" || !["game", "rtp"].includes(resource.role)) {continue;}
    const policy = session.inputPolicy(resource.role);
    const sources = await resourceSources(resource, policy, signal);
    for (const source of sources) {files.set(source.url, {source, policy});}
    if (resource.role !== "game") {continue;}
    const root = new URL(`${resource.indexUrl}/`, location.href).href;
    const paths: string[] = [];
    for (const source of sources) {
      if (source.identity.kind !== "INDEX_ENTRY") {throw new Error("RPG_RUNTIME_PACK_INVALID");}
      const path = source.identity.logicalPath;
      paths.push(path);
      files.set(root + path.split("/").map(encodeURIComponent).join("/"), {source, policy});
    }
    files.set(`${root}index.json`, {metadata: new TextEncoder().encode(JSON.stringify(easyRpgProjectIndex(paths)))});
  }
  signal.throwIfAborted();
  const cleanup = installContentXHR(frame, files, session, signal);
  try {
    const adapter = await mount();
    return {...adapter, exit: async () => {try {await adapter.exit();} finally {cleanup();}}};
  } catch (error) {cleanup(); throw error;}
}
