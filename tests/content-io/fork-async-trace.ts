import {createContentSession} from "../../src/content-io/client.js";
import {byteAt} from "./fixture-bytes.mjs";
import type {ContentSourceV1, ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import type {ContentSessionService} from "../../src/content-io/service.js";
type Stats = ContentSessionService["stats"];
type Polling = {read(pointer: number, offset: number, length: number): void; isDone(): boolean; hasError(): boolean; close(): void};
type VLFS = {init(): Promise<void>; registerContent(path: string, handle: {fileId: string; sizeBytes: number}, reader: ContentReaderV1): void;
  open(path: string, mode: number): number; seek(fd: number, offset: number, whence: number): number;
  read(fd: number, length: number): Promise<Uint8Array>; readCached(fd: number, length: number): Uint8Array | null;
  close(fd: number): void; stats(): {blockCacheBytes: number}};

async function openFacade(kind: "play" | "kirikiri", reader: ContentReaderV1) {
  const moduleUrl = "/__test__/facade.mjs";
  if (kind === "play") {
    const {discDevice} = await import(moduleUrl) as {discDevice(module: {HEAPU8: Uint8Array}, reader: ContentReaderV1, fail: (error: Error) => void): Polling};
    const memory = {HEAPU8: new Uint8Array(8208)};
    let failure: Error | undefined;
    const device = discDevice(memory, reader, error => {failure = error;});
    return {async read(offset: number, length: number) {
      device.read(8, offset, length);
      // Every request replaces the heap after the first await, exercising the native memory.grow boundary.
      memory.HEAPU8 = new Uint8Array(8208);
      while (!device.isDone()) {await new Promise(resolve => setTimeout(resolve, 0));}
      if (failure || device.hasError()) {throw failure ?? new Error("TRACE_POLLING_ERROR");}
      return memory.HEAPU8.subarray(8, 8 + length);
    }, close() {device.close();}, privateBytes: () => 0};
  }
  await import(moduleUrl);
  const vlfs = (globalThis as unknown as {VLFS: VLFS}).VLFS;
  await vlfs.init(); vlfs.registerContent("/trace.xp3", {fileId: reader.id, sizeBytes: reader.sizeBytes}, reader);
  const fd = vlfs.open("/trace.xp3", 0);
  return {read(offset: number, length: number) {
    if (vlfs.seek(fd, offset, 0) !== offset) {throw new Error("TRACE_SEEK");}
    return vlfs.readCached(fd, length) ?? vlfs.read(fd, length);
  }, close() {vlfs.close(fd);}, privateBytes: () => vlfs.stats().blockCacheBytes};
}

export async function forkAsyncTrace(kind: "play" | "kirikiri", source: ContentSourceV1) {
  const worker = new Worker("/__test__/worker.mjs", {type: "module"});
  const session = await createContentSession(worker, {storageOrigin: location.origin, allowedOrigins: [location.origin]});
  const stats = () => new Promise<Stats>((resolve, reject) => {
    const id = crypto.randomUUID(), timer = setTimeout(() => {worker.removeEventListener("message", listener); reject(new Error("TRACE_STATS_TIMEOUT"));}, 5000);
    const listener = ({data}: MessageEvent) => {if (data.id === id) {clearTimeout(timer); worker.removeEventListener("message", listener); resolve(data.stats);}};
    worker.addEventListener("message", listener); worker.postMessage({type: "TEST_STATS", id});
  });
  try {
    const reader = await session.open(source, {mode: "RANGE", bridge: kind === "play" ? "POLLING" : "VLFS", result: "READER",
      maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
    const facade = await openFacade(kind, reader);
    const snapshots = [{read: 0, l1: session.stats.lruBytes, service: await stats(), privateBytes: facade.privateBytes()}];
    let seed = 0x1234abcd, synchronousHits = 0;
    const next = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed;};
    try {
      for (let index = 0; index < 10000; index++) {
        const length = 1 + next() % 8192, offset = next() % Math.min(source.sizeBytes - length, index % 16 === 0 ? source.sizeBytes : 1048576);
        const pending = facade.read(offset, length); if (pending instanceof Uint8Array) {synchronousHits++;}
        const bytes = await pending;
        if (bytes.length !== length || bytes.some((value, position) => value !== byteAt(offset + position, 17))) {throw new Error(`TRACE_BYTES:${index}`);}
        bytes.fill(255);
        if ((index + 1) % 250 === 0) {snapshots.push({read: index + 1, l1: session.stats.lruBytes, service: await stats(), privateBytes: facade.privateBytes()});}
      }
    } finally {facade.close(); await reader.close();}
    let closed = await stats();
    for (let retry = 0; retry < 100 && (closed.pending || closed.temporaryBytes); retry++) {await new Promise(resolve => setTimeout(resolve, 10)); closed = await stats();}
    return {snapshots, synchronousHits, closed, l1Peak: session.blocks.cache.peakByteLength};
  } finally {await session.close();}
}
