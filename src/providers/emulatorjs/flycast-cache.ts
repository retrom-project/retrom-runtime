import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";

type Disc = {url: string; sizeBytes: number; sha256: string};
type Progress = (loaded: number, total: number) => void;
type Writer = {write(bytes: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(): Promise<void>};
type Directory = {
  getFileHandle(name: string, options?: {create: boolean}): Promise<{
    getFile(): Promise<Blob>; createWritable(): Promise<Writer>;
  }>;
  removeEntry(name: string): Promise<void>;
};
type Options = {directory(): Promise<Directory>; fetchBytes: typeof fetch};
class CacheWriteError extends Error {}
const integrityError = () => new Error("FLYCAST_DISC_INTEGRITY_INVALID");

/** Content-addressed OPFS files survive iframe/Launch teardown; no HTTP-cache dependency. */
export async function loadFlycastDisc(disc: Disc, signal: AbortSignal, progress: Progress,
  options: Options = {
    directory: async () => (await navigator.storage.getDirectory()).getDirectoryHandle("retrom-flycast-chd-v1", {create: true}),
    fetchBytes: fetch,
  }): Promise<Blob> {
  signal.throwIfAborted();
  validateDisc(disc);
  let directory: Directory | null = null;
  try {directory = await options.directory();} catch { /* Storage can be denied by browser policy. */ }
  const name = `${disc.sha256}.chd`;
  if (directory) {
    try {
      const cached = await (await directory.getFileHandle(name)).getFile();
      if (cached.size !== disc.sizeBytes) {throw integrityError();}
      await consume(cached.stream(), disc, signal, () => {}, async () => {});
      progress(disc.sizeBytes, disc.sizeBytes);
      return cached;
    } catch {
      signal.throwIfAborted();
      await directory.removeEntry(name).catch(() => {});
    }
  }
  let writer: Writer | null = null;
  if (directory) {
    try {writer = await (await directory.getFileHandle(name, {create: true})).createWritable();}
    catch { /* Continue with a normal network read if the cache cannot be opened. */ }
  }
  try {
    const blob = await download(disc, signal, progress, options.fetchBytes, writer);
    if (!writer || !directory) {return blob!;}
    try {
      await writer.close();
      return await (await directory.getFileHandle(name)).getFile();
    } catch (error) {throw new CacheWriteError("FLYCAST_CACHE_WRITE_FAILED", {cause: error});}
  } catch (error) {
    await writer?.abort().catch(() => {});
    await directory?.removeEntry(name).catch(() => {});
    signal.throwIfAborted();
    if (!(error instanceof CacheWriteError)) {throw error;}
    return (await download(disc, signal, progress, options.fetchBytes, null))!;
  }
}

async function download(disc: Disc, signal: AbortSignal, progress: Progress, fetchBytes: typeof fetch, writer: Writer | null) {
  const response = await fetchBytes(disc.url, {signal});
  if (response.status !== 200 || !response.body) {throw new Error("FLYCAST_DISC_DOWNLOAD_FAILED");}
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  progress(0, disc.sizeBytes);
  await consume(response.body, disc, signal, progress, async (chunk) => {
    if (!writer) {chunks.push(chunk); return;}
    try {await writer.write(chunk);}
    catch (error) {throw new CacheWriteError("FLYCAST_CACHE_WRITE_FAILED", {cause: error});}
  });
  return writer ? null : new Blob(chunks);
}

async function consume(stream: ReadableStream<Uint8Array>, disc: Disc, signal: AbortSignal,
  progress: Progress, accept: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>) {
  const reader = stream.getReader(), digest = sha256.create();
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {value, done} = await reader.read();
      if (done) {break;}
      size += value.byteLength;
      if (size > disc.sizeBytes) {throw integrityError();}
      digest.update(value);
      await accept(value as Uint8Array<ArrayBuffer>);
      progress(size, disc.sizeBytes);
    }
    if (size !== disc.sizeBytes || bytesToHex(digest.digest()) !== disc.sha256) {throw integrityError();}
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    digest.destroy();
  }
}

function validateDisc(disc: Disc) {
  if (!/^[a-f0-9]{64}$/u.test(disc.sha256) || !Number.isSafeInteger(disc.sizeBytes) ||
    disc.sizeBytes < 1 || disc.sizeBytes > 2 ** 31 - 1) {throw integrityError();}
}
