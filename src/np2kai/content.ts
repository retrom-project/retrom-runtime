import type {RuntimeProgressReporter} from "../internal-adapter.js";
export type DiskSource = {url: string; sha256: string; sizeBytes: number};
export type DiskStore = {get(key: string): Promise<Uint8Array | null>; put(key: string, bytes: Uint8Array): Promise<void>};
const maximumDisk = 512 * 1024 * 1024;
const invalid = () => new Error("NP2KAI_DISK_INVALID");
export async function loadDisk(source: DiskSource, progress: RuntimeProgressReporter, store: DiskStore | null, signal?: AbortSignal) {
  validateSource(source);
  signal?.throwIfAborted();
  const report = (loadedBytes: number) => progress({phase: "PROJECT_CONTENT", loadedBytes, totalBytes: source.sizeBytes});
  report(0);
  const cached = await store?.get(source.url).catch(() => null);
  if (cached && await validBytes(cached, source)) {signal?.throwIfAborted(); report(cached.length); return cached;}
  const response = await fetch(source.url, {credentials: "same-origin", redirect: "error", signal});
  if (!response.ok || !response.body) {throw new Error("NP2KAI_DISK_FETCH_FAILED");}
  const bytes = new Uint8Array(source.sizeBytes), reader = response.body.getReader();
  let offset = 0, reported = 0;
  try {
    for (;;) {
      signal?.throwIfAborted(); const {done, value} = await reader.read(); if (done) {break;}
      if (offset + value.length > bytes.length) {throw invalid();}
      bytes.set(value, offset); offset += value.length;
      if (offset - reported >= 1048576) {report(offset); reported = offset;}
    }
    if (offset !== source.sizeBytes || !await validBytes(bytes, source)) {throw invalid();}
    await store?.put(source.url, bytes).catch(() => undefined);
    signal?.throwIfAborted(); report(bytes.length); return bytes;
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
async function validBytes(bytes: Uint8Array, source: DiskSource) {
  if (bytes.length !== source.sizeBytes) {return false;}
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
  return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("") === source.sha256;
}
export async function openDiskStore(win: Window): Promise<DiskStore | null> {
  try {
    const root = await win.navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("retrom-np2kai-disks-v1", {create: true});
    const name = async (url: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))), value => value.toString(16).padStart(2, "0")).join("");
    return {
      async get(url) {
        try {return new Uint8Array(await (await (await directory.getFileHandle(await name(url))).getFile()).arrayBuffer());}
        catch {return null;}
      },
      async put(url, bytes) {
        const handle = await directory.getFileHandle(await name(url), {create: true}), writer = await handle.createWritable();
        try {await writer.write(bytes.slice()); await writer.close();}
        catch (error) {await writer.abort().catch(() => undefined); throw error;}
      },
    };
  } catch {return null;}
}

function validateSource(source: DiskSource) {
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > maximumDisk ||
      !/^[0-9a-f]{64}$/u.test(source.sha256)) {throw invalid();}
}
