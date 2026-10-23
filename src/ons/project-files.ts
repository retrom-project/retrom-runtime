import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import {checkSignal, combineSignals} from "../content-io/abort.js";
import {ContentIOError} from "../content-io/errors.js";
export type OnsProjectFile = {path: string; sizeBytes: number; url: string};
export type OnsProjectFileNode = OnsProjectFile;
type Content = {contentSession: AdapterContentSession; projectDigest: string; signal?: AbortSignal; onFailure?: (error: Error) => void};
/** Native ABI of window.g_onsyuri_content, read by the core's fopen() streams. */
export const onsContentAbi = "ons-content-io-v1";
// Content I/O serves at most 16 MiB per logical read; larger native reads are split.
const maximumReadBytes = 16 * 1024 * 1024;
// The synchronous probe allocates its result up front, so it is only tried for buffer-sized reads.
const maximumProbeBytes = 1024 * 1024;
export type OnsContentBridge = {
  readonly abi: typeof onsContentAbi;
  /** A positive handle, 0 when the path is not a project file, or -1 on failure. */
  open(path: string): Promise<number>;
  size(handle: number): number;
  /** Cached bytes only: null unless the whole range is already local. */
  tryRead(handle: number, offset: number, length: number): Uint8Array | null;
  read(handle: number, offset: number, length: number): Promise<Uint8Array | null>;
  close(handle: number): void;
};
/**
 * Project files for the ONS core. The core opens files lazily and reads byte ranges through the
 * bridge, so large archives such as arc.nsa are fetched only where the engine reads them.
 */
export function createOnsProjectFileMap(files: OnsProjectFile[], frameWindow: Window, _reportProgress: RuntimeProgressReporter, content?: Content) {
  if (!content) {throw new ContentIOError("ABI_MISMATCH");}
  const controller = new AbortController(), scope = combineSignals([controller.signal, ...(content.signal ? [content.signal] : [])]);
  const map: Record<string, OnsProjectFileNode> = Object.create(null) as Record<string, OnsProjectFileNode>;
  for (const file of files) {map[`/game/${file.path}`.toLowerCase()] = {...file, path: `/game/${file.path}`};}
  const pending = new Set<Promise<unknown>>();
  const track = <T>(task: Promise<T>) => {
    pending.add(task); void task.finally(() => pending.delete(task)).catch(() => {}); return task;
  };
  const readers = new Map<number, ContentReaderV1>();
  let nextHandle = 1;
  const fail = (error: unknown) => {if (!scope.signal.aborted && error instanceof Error) {content.onFailure?.(error);}};
  const source = (node: OnsProjectFileNode) => {
    const policy = content.contentSession.inputPolicy("game");
    return {source: {identity: {kind: "INDEX_ENTRY" as const, projectDigest: content.projectDigest, logicalPath: node.path.slice(6)},
      url: new URL(node.url, frameWindow.document.baseURI).href, sizeBytes: node.sizeBytes, purpose: "GAME" as const,
      transport: "RANGE_REQUIRED" as const, etagPolicy: "PIN_STRONG" as const, contentLengthPolicy: policy.contentLengthPolicy}, policy};
  };
  const reader = (handle: number) => {
    const value = readers.get(handle); if (!value) {throw new ContentIOError("SOURCE_INVALID");} return value;
  };
  const span = (handle: number, offset: number, length: number) => {
    const file = reader(handle);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {throw new ContentIOError("SOURCE_INVALID");}
    return {file, bytes: new Uint8Array(Math.max(0, Math.min(length, file.sizeBytes - offset)))};
  };
  const bridge: OnsContentBridge = {
    abi: onsContentAbi,
    open: path => track((async () => {
      try {
        checkSignal(scope.signal);
        const node = map[path.toLowerCase()];
        if (!node) {return 0;}
        const {source: declared, policy} = source(node);
        const opened = await content.contentSession.open(declared, policy, scope.signal);
        if (scope.signal.aborted) {await opened.close(); return -1;}
        const handle = nextHandle++;
        readers.set(handle, opened);
        return handle;
      } catch (error) {fail(error); return -1;}
    })()),
    size: handle => reader(handle).sizeBytes,
    tryRead(handle, offset, length) {
      if (scope.signal.aborted || length > maximumProbeBytes) {return null;}
      const {file, bytes} = span(handle, offset, length);
      return bytes.length === 0 || file.tryReadInto(offset, bytes) === bytes.length ? bytes : null;
    },
    read: (handle, offset, length) => track((async () => {
      try {
        checkSignal(scope.signal);
        const {file, bytes} = span(handle, offset, length);
        for (let done = 0; done < bytes.length;) {
          const part = bytes.subarray(done, Math.min(bytes.length, done + maximumReadBytes));
          const read = await file.readInto(offset + done, part, scope.signal);
          if (read !== part.length) {throw new ContentIOError("SOURCE_INVALID");}
          done += read;
        }
        checkSignal(scope.signal);
        return bytes;
      } catch (error) {fail(error); return null;}
    })()),
    close(handle) {
      const file = readers.get(handle); readers.delete(handle);
      if (file) {void track(file.close()).catch(fail);}
    },
  };
  return {
    bridge,
    fileMap: map,
    hasPendingReads: () => pending.size > 0,
    videoSource: content.contentSession.preloaded ? (node: OnsProjectFileNode) => track((async () => {
      checkSignal(scope.signal);
      // Preloaded video plays from a leased local Blob, as before; only native reads use ranges.
      const policy = {...content.contentSession.inputPolicy("game"), mode: "ON_OPEN" as const, bridge: "NONE" as const, result: "BLOB" as const};
      const reader = await content.contentSession.open({identity: {kind: "INDEX_ENTRY", projectDigest: content.projectDigest, logicalPath: node.path.slice(6)},
        url: new URL(node.url, frameWindow.document.baseURI).href, sizeBytes: node.sizeBytes, purpose: "GAME", transport: "WHOLE_ALLOWED",
        etagPolicy: "PIN_STRONG", contentLengthPolicy: policy.contentLengthPolicy}, policy, scope.signal);
      try {
        const result = await content.contentSession.materialize(reader.id, {kind: "BLOB", maxBytes: policy.maxFileBytes}, scope.signal);
        if (result.kind !== "BLOB") {throw new ContentIOError("INTERNAL");}
        try {
          checkSignal(scope.signal);
          const url = URL.createObjectURL(result.blob);
          return {url, release: () => {URL.revokeObjectURL(url); void result.release();}};
        } catch (error) {await result.release(); throw error;}
      } finally {await reader.close();}
    })()) : undefined,
    async close() {
      controller.abort();
      const open = [...readers.values()]; readers.clear();
      await Promise.allSettled([...pending, ...open.map(file => file.close())]);
      scope.dispose();
    },
  };
}
