import {neoCDRangeBlockSize} from "./neocd-range.js";

export type VirtualContentFile = {
  filename: string; sizeBytes: number; canSuspend: boolean;
  contents?: Uint8Array;
  read(position: number, length: number): Uint8Array | Promise<Uint8Array>;
  begin(): void; end(): void; fail(error: Error): void;
  idle(): Promise<void>; dispose(): Promise<void>;
};

type VirtualNode = {usedBytes: number; contents?: Uint8Array; stream_ops: {
  read?: (stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number) => number;
  [key: string]: unknown;
}};
type VirtualFS = {
  writeFile(path: string, data: Uint8Array, ...options: unknown[]): void;
  lookupPath(path: string): {node: VirtualNode};
};
type Asyncify = {state: number; State: {Normal: number; Rewinding: number};
  handleSleep(start: (wake: (value: number) => void) => void): number};
type VirtualModule = {FS?: VirtualFS; retromContentIOAsyncify?: () => Asyncify};
type Instance = {Module?: unknown; on?: (event: string, callback: (...args: unknown[]) => void) => void};

/** Attach the shared FS mount before EmulatorJS copies the game into its FS. */
export function registerSeekableContentFS(instance: Instance, range: VirtualContentFile, fail: (error: unknown) => void): () => void {
  if (!instance.on) {throw new Error("EMULATORJS_CONTENT_FS_UNAVAILABLE");}
  let cleanup: (() => void) | null = null;
  let closed = false;
  instance.on("saveDatabaseLoaded", () => {
    if (closed) {return;}
    try {cleanup = installSeekableContentFS(instance, range);}
    catch (error) {fail(error);}
  });
  return () => {closed = true; cleanup?.(); cleanup = null;};
}

/** Mount a Content I/O reader at the shared EmulatorJS FS write boundary. */
export function installSeekableContentFS(instance: Instance, range: VirtualContentFile): () => void {
  const module = instance.Module as VirtualModule | undefined;
  const fs = module?.FS, asyncify = module?.retromContentIOAsyncify?.();
  if (!fs || range.canSuspend && (!asyncify || typeof asyncify.handleSleep !== "function")) {
    throw new Error("EMULATORJS_CONTENT_FS_UNAVAILABLE");
  }
  const writeFile = fs.writeFile;
  let mounted: VirtualNode | null = null;
  let originalOps: VirtualNode["stream_ops"] | null = null;
  let originalSize = 0;
  let originalContents: Uint8Array | undefined;
  fs.writeFile = function(path, data, ...options) {
    if (path.split("/").pop() !== range.filename) {return writeFile.call(fs, path, data, ...options);}
    if (mounted) {throw new Error("EMULATORJS_CONTENT_FS_DUPLICATE");}
    writeFile.call(fs, path, data, ...options);
    const node = fs.lookupPath(path).node;
    originalOps = node.stream_ops;
    originalSize = node.usedBytes;
    originalContents = node.contents;
    node.usedBytes = range.sizeBytes;
    if (range.contents) {node.contents = range.contents;}
    node.stream_ops = {...originalOps, read: (_stream: unknown, buffer: Uint8Array, offset: number,
      length: number, position: number) => readContent(range, asyncify, buffer, offset, length, position)};
    mounted = node;
  };
  return () => {
    fs.writeFile = writeFile;
    if (mounted && originalOps) {
      mounted.stream_ops = originalOps; mounted.usedBytes = originalSize;
      if (range.contents) {mounted.contents = originalContents;}
    }
    mounted = null;
  };
}

function readContent(range: VirtualContentFile, asyncify: Asyncify | undefined, buffer: Uint8Array,
  offset: number, length: number, position: number): number {
  if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0) {
    throw new Error("EMULATORJS_CONTENT_FS_BOUNDS");
  }
  const count = Math.min(length, Math.max(0, range.sizeBytes - position));
  if (count === 0) {return 0;}
  if (!range.canSuspend) {
    let done = 0;
    while (done < count) {
      const size = Math.min(neoCDRangeBlockSize, count - done);
      const result = range.read(position + done, size);
      if (!(result instanceof Uint8Array)) {throw new Error("EMULATORJS_CONTENT_FS_UNEXPECTED_ASYNC_READ");}
      buffer.set(result, offset + done);
      done += size;
    }
    return done;
  }
  if (!asyncify) {throw new Error("EMULATORJS_CONTENT_FS_UNAVAILABLE");}
  // On rewind the original read has already filled the Wasm buffer. Asyncify
  // must consume its saved return value before any new Content I/O work.
  if (asyncify.state === asyncify.State.Rewinding) {return asyncify.handleSleep(() => {});}
  let done = 0;
  let pending: Promise<Uint8Array> | null = null;
  let pendingSize = 0;
  while (done < count) {
    const size = Math.min(neoCDRangeBlockSize, count - done);
    const result = range.read(position + done, size);
    if (!(result instanceof Uint8Array)) {pending = result; pendingSize = size; break;}
    buffer.set(result, offset + done);
    done += size;
  }
  if (!pending) {return done;}
  if (asyncify.state !== asyncify.State.Normal) {throw new Error("EMULATORJS_CONTENT_FS_REENTRANT");}
  return asyncify.handleSleep(wake => {
    let suspended = false;
    let settled = false;
    const finish = (value: number) => {
      if (settled) {return;}
      settled = true;
      try {wake(value);} finally {if (suspended) {range.end();}}
    };
    const fail = (error: unknown) => {
      const failure = error instanceof Error ? error : new Error("EMULATORJS_CONTENT_FS_READ_FAILED");
      finish(-1); range.fail(failure);
    };
    const advance = (done: number) => {
      try {
        while (done < count) {
          const size = Math.min(neoCDRangeBlockSize, count - done);
          const result = range.read(position + done, size);
          if (result instanceof Uint8Array) {
            buffer.set(result, offset + done);
            done += size;
            continue;
          }
          if (!suspended) {range.begin(); suspended = true;}
          void result.then(bytes => {
            buffer.set(bytes, offset + done);
            advance(done + size);
          }, fail);
          return;
        }
        finish(done);
      } catch (error) {if (settled) {throw error;} fail(error);}
    };
    range.begin(); suspended = true;
    void pending.then(bytes => {
      buffer.set(bytes, offset + done);
      advance(done + pendingSize);
    }, fail);
  });
}
