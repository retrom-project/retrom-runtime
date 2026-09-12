import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type PSPSource = {url: string; sha256: string; sizeBytes: number};
export type PSPStore = {get(key: string): Promise<Blob | null>; put(key: string, file: Blob): Promise<void>};
const maximum = 2147483647;
const invalid = () => new Error("PPSSPP_CONTENT_INVALID");

export async function loadPSPFile(source: PSPSource, progress: RuntimeProgressReporter, store: PSPStore | null, signal?: AbortSignal): Promise<Blob> {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > maximum ||
    !/^[0-9a-f]{64}$/u.test(source.sha256)) {throw invalid();}
  signal?.throwIfAborted();
  const report = (loadedBytes: number) => progress({phase: "PROJECT_CONTENT", loadedBytes, totalBytes: source.sizeBytes});
  report(0);
  const cached = await store?.get(source.url).catch(() => null);
  if (cached?.size === source.sizeBytes && await digest(cached.stream(), signal).catch(() => null) === source.sha256) {
    signal?.throwIfAborted(); report(cached.size); return cached;
  }
  signal?.throwIfAborted();
  const response = await fetch(source.url, {credentials: "same-origin", redirect: "error", signal});
  if (!response.ok || !response.body) {throw new Error("PPSSPP_CONTENT_FETCH_FAILED");}
  const file = await download(response.body, source, report, signal);
  await store?.put(source.url, file).catch(() => undefined);
  signal?.throwIfAborted(); report(file.size); return file;
}
async function download(stream: ReadableStream<Uint8Array>, source: PSPSource, report: (n: number) => void, signal?: AbortSignal) {
  const reader = stream.getReader(), hash = sha256.create(), chunks: BlobPart[] = [];
  let size = 0, reported = 0;
  try {
    for (;;) {
      signal?.throwIfAborted(); const {done, value} = await reader.read(); if (done) {break;}
      size += value.byteLength; if (size > source.sizeBytes) {throw invalid();}
      hash.update(value); chunks.push(value.slice());
      if (size - reported >= 1048576) {report(size); reported = size;}
    }
    if (size !== source.sizeBytes || bytesToHex(hash.digest()) !== source.sha256) {throw invalid();}
    signal?.throwIfAborted(); return new Blob(chunks);
  } finally {hash.destroy(); await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
async function digest(stream: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = stream.getReader(), hash = sha256.create();
  try {
    for (;;) {signal?.throwIfAborted(); const {done, value} = await reader.read(); if (done) {break;} hash.update(value);}
    return bytesToHex(hash.digest());
  } finally {hash.destroy(); await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
export async function openPSPStore(win: Window): Promise<PSPStore | null> {
  try {
    const root = await win.navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("retrom-ppsspp-content-v1", {create: true});
    const name = (url: string) => bytesToHex(sha256(new TextEncoder().encode(url)));
    return {
      async get(url) {try {return await (await directory.getFileHandle(name(url))).getFile();} catch {return null;}},
      async put(url, file) {
        const handle = await directory.getFileHandle(name(url), {create: true}), writer = await handle.createWritable();
        try {await writer.write(file); await writer.close();}
        catch (error) {await writer.abort().catch(() => undefined); throw error;}
      },
    };
  } catch {return null;}
}
