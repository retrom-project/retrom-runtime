import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {checkSignal, combineSignals} from "../content-io/abort.js";
import {ContentIOError} from "../content-io/errors.js";
import {contentLimits} from "../content-io/limits.js";
export type OnsProjectFile = {path: string; sizeBytes: number; url: string};
export type OnsProjectFileNode = OnsProjectFile & {loaded: boolean; loading?: Promise<void>};
type Writer = {writeFile(path: string, bytes: Uint8Array): void};
type Content = {contentSession: AdapterContentSession; projectDigest: string; signal?: AbortSignal; onFailure?: (error: Error) => void};
export function createOnsProjectFileMap(files: OnsProjectFile[], frameWindow: Window, _reportProgress: RuntimeProgressReporter, content?: Content) {
  if (!content) {throw new ContentIOError("ABI_MISMATCH");}
  const controller = new AbortController(), scope = combineSignals([controller.signal, ...(content.signal ? [content.signal] : [])]);
  const map: Record<string, OnsProjectFileNode> = Object.create(null) as Record<string, OnsProjectFileNode>;
  for (const file of files) {map[`/game/${file.path}`.toLowerCase()] = {...file, path: `/game/${file.path}`, loaded: false};}
  const pending = new Set<Promise<unknown>>();
  const read = (node: OnsProjectFileNode) => {
    const task = loadProjectFile(node, frameWindow.document.baseURI, content, scope.signal);
    pending.add(task); void task.finally(() => pending.delete(task)).catch(() => {}); return task;
  };
  return {
    fileMap: map,
    async readBytes(key: string) {
      checkSignal(scope.signal); const node = map[key.toLowerCase()]; if (!node) {throw new ContentIOError("SOURCE_INVALID");}
      const bytes = await read(node); checkSignal(scope.signal); return bytes;
    },
    async fetchFile(fs: Writer, key: string) {
      try {
        checkSignal(scope.signal); const node = map[key.toLowerCase()];
        if (!node) {return 0;} if (node.loaded) {return 1;}
        node.loading ??= read(node).then(bytes => {checkSignal(scope.signal); fs.writeFile(node.path, bytes); node.loaded = true;})
          .catch((error: unknown) => {node.loading = undefined; throw error;});
        await node.loading; checkSignal(scope.signal); return 1;
      } catch (error) {
        if (!scope.signal.aborted && error instanceof Error) {content.onFailure?.(error);} return -1;
      }
    },
    async close() {controller.abort(); await Promise.allSettled([...pending]); scope.dispose();},
  };
}
async function loadProjectFile(node: OnsProjectFileNode, base: string, content: Content, signal: AbortSignal) {
  checkSignal(signal); const policy = eagerPolicy(contentLimits.indexedFile, {mode: "ON_OPEN"});
  const reader = await content.contentSession.open({identity: {kind: "INDEX_ENTRY", projectDigest: content.projectDigest, logicalPath: node.path.slice(6)},
    url: new URL(node.url, base).href, sizeBytes: node.sizeBytes, purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "PIN_STRONG",
    contentLengthPolicy: policy.contentLengthPolicy, }, policy, signal);
  try {
    const result = await content.contentSession.materialize(reader.id, {kind: "BYTES", maxBytes: policy.maxFileBytes}, signal);
    if (result.kind !== "BYTES") {throw new ContentIOError("INTERNAL");} return result.bytes;
  } finally {await reader.close();}
}
