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
  streams?: Array<{node: VirtualNode; position: number} | null>;
  writeFile(path: string, data: Uint8Array, ...options: unknown[]): void;
  lookupPath(path: string): {node: VirtualNode};
};
type Asyncify = {state: number; State: {Normal: number; Rewinding: number};
  handleSleep(start: (wake: (value: number) => void) => void): number};
type VirtualModule = {FS?: VirtualFS; HEAPU8?: Uint8Array; retromContentIOAsyncify?: () => Asyncify;
  retromDaphneFdRead?: (fd: number, iov: number, iovcnt: number, pnum: number) => Promise<number | null>};
type Instance = {Module?: unknown; on?: (event: string, callback: (...args: unknown[]) => void) => void};

/** Attach the shared FS mount before EmulatorJS copies the game into its FS. */
export function registerSeekableContentFS(instance: Instance, range: VirtualContentFile, fail: (error: unknown) => void,
  workerReadBridge = false): () => void {
  if (!instance.on) {throw new Error("EMULATORJS_CONTENT_FS_UNAVAILABLE");}
  let cleanup: (() => void) | null = null;
  let closed = false;
  instance.on("saveDatabaseLoaded", () => {
    if (closed) {return;}
    try {cleanup = installSeekableContentFS(instance, range, workerReadBridge);}
    catch (error) {fail(error);}
  });
  return () => {closed = true; cleanup?.(); cleanup = null;};
}

/** Mount a Content I/O reader at the shared EmulatorJS FS write boundary. */
export function installSeekableContentFS(instance: Instance, range: VirtualContentFile, workerReadBridge = false): () => void {
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
  const originalWorkerRead = module?.retromDaphneFdRead;
  if (workerReadBridge) {
    if (!module || !fs.streams || !module.HEAPU8) {throw new Error("EMULATORJS_CONTENT_FS_UNAVAILABLE");}
    let pending: Promise<unknown> = Promise.resolve();
    module.retromDaphneFdRead = (fd, iov, iovcnt, pnum) => {
      const stream = fs.streams?.[fd];
      if (!mounted || !stream || stream.node !== mounted) {return Promise.resolve(null);}
      const next = pending.then(async () => {
        range.begin();
        try {
          if (!Number.isSafeInteger(stream.position) || stream.position < 0 ||
            !Number.isSafeInteger(iovcnt) || iovcnt < 0 || iovcnt > 1024) {throw new Error("EMULATORJS_CONTENT_FS_BOUNDS");}
          let total = 0;
          for (let index = 0; index < iovcnt; index++) {
            const heap = module.HEAPU8!;
            const view = new DataView(heap.buffer);
            const vector = iov + index * 8;
            if (vector < 0 || vector + 8 > heap.byteLength) {throw new Error("EMULATORJS_CONTENT_FS_BOUNDS");}
            const pointer = view.getUint32(vector, true);
            const length = view.getUint32(vector + 4, true);
            const count = Math.min(length, Math.max(0, range.sizeBytes - stream.position));
            if (pointer + count > heap.byteLength) {throw new Error("EMULATORJS_CONTENT_FS_BOUNDS");}
            for (let done = 0; done < count;) {
              const size = Math.min(neoCDRangeBlockSize, count - done);
              const bytes = await range.read(stream.position, size);
              if (bytes.byteLength !== size) {throw new Error("EMULATORJS_CONTENT_FS_SHORT_READ");}
              module.HEAPU8!.set(bytes, pointer + done);
              stream.position += size; total += size; done += size;
            }
            if (count < length) {break;}
          }
          const heap = module.HEAPU8!;
          if (pnum < 0 || pnum + 4 > heap.byteLength) {throw new Error("EMULATORJS_CONTENT_FS_BOUNDS");}
          new DataView(heap.buffer).setUint32(pnum, total, true);
          return 0;
        } catch (error) {
          range.fail(error instanceof Error ? error : new Error("EMULATORJS_CONTENT_FS_READ_FAILED"));
          return 29; // EIO in the pinned Emscripten libc.
        } finally {range.end();}
      });
      pending = next;
      return next;
    };
  }
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
    if (workerReadBridge && module) {module.retromDaphneFdRead = originalWorkerRead;}
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
