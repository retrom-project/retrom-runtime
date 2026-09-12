import type {RuntimeProgressReporter} from "../internal-adapter.js";

export type ProjectFile = {path: string; sizeBytes: number; url: string};
const maximumFileBytes = 32 * 1024 * 1024;
const maximumProjectBytes = 64 * 1024 * 1024;
export function parseIndex(value: unknown): ProjectFile[] {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 ||
    !("files" in value) || !Array.isArray(value.files) || value.files.length > 4096) {throw invalid();}
  const seen = new Set<string>();
  let total = 0;
  const files = value.files.map((file: unknown) => {
    if (!file || typeof file !== "object") {throw invalid();}
    const entry = file as Partial<ProjectFile>;
    if (typeof entry.path !== "string" || !safePath(entry.path) || typeof entry.url !== "string" ||
      typeof entry.sizeBytes !== "number" || !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes < 0 || entry.sizeBytes > maximumFileBytes || seen.has(entry.path.toLowerCase())) {throw invalid();}
    seen.add(entry.path.toLowerCase()); total += entry.sizeBytes;
    if (total > maximumProjectBytes) {throw invalid();}
    return {path: entry.path, sizeBytes: entry.sizeBytes, url: entry.url};
  });
  if (!["doukutsu.exe", "data/npc.tbl", "data/stage/start.pxm", "data/stage/start.tsc"].every((name) => seen.has(name))) {
    throw invalid();
  }
  return files;
}
export async function loadProject(indexUrl: string, progress: RuntimeProgressReporter, signal?: AbortSignal) {
  indexUrl = new URL(indexUrl, window.location.href).href;
  const response = await fetch(indexUrl, {credentials: "same-origin", redirect: "error", signal});
  const raw = await readBounded(response, 2 * 1024 * 1024, signal);
  const files = parseIndex(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(raw)));
  const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  const result: {path: string; bytes: Uint8Array}[] = [];
  let loadedBytes = 0;
  progress({phase: "PROJECT_CONTENT", loadedBytes, totalBytes});
  for (const file of files) {
    const bytes = await fetchContent({...file, url: new URL(file.url, indexUrl).href}, (loaded) => {
      progress({phase: "PROJECT_CONTENT", loadedBytes: loadedBytes + loaded, totalBytes});
    }, signal);
    result.push({path: file.path, bytes}); loadedBytes += bytes.length;
  }
  return result;
}
export async function fetchContent(file: {url: string; sizeBytes: number}, progress: (loaded: number) => void, signal?: AbortSignal) {
  let cache: Cache | undefined;
  try {cache = await caches.open("retrom-nxengine-content-v1");} catch { /* Storage is optional. */ }
  if (cache) {
    try {
      const hit = await cache.match(file.url);
      if (hit) {const data = await exactBytes(hit, file.sizeBytes, signal); progress(data.length); return data;}
    } catch {await cache.delete(file.url).catch(() => false); signal?.throwIfAborted();}
  }
  const response = await fetch(file.url, {credentials: "same-origin", redirect: "error", signal});
  const bytes = await exactBytes(response, file.sizeBytes, signal);
  await cache?.put(file.url, new Response(Uint8Array.from(bytes))).catch(() => undefined);
  progress(bytes.length);
  return bytes;
}
async function exactBytes(response: Response, size: number, signal?: AbortSignal) {
  const bytes = await readBounded(response, size, signal);
  if (bytes.length !== size) {throw invalid();} return bytes;
}
async function readBounded(response: Response, maximum: number, signal?: AbortSignal) {
  if (!response.ok || !response.body) {throw new Error("NXENGINE_FETCH_FAILED");}
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted(); const next = await reader.read(); if (next.done) {break;}
      size += next.value.length; if (size > maximum) {throw invalid();} chunks.push(next.value);
    }
  } finally {void reader.cancel().catch(() => undefined); reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;} return bytes;
}
function safePath(path: string) {
  return path.length <= 1024 && !/[\\:]/u.test(path) && !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}
function invalid() {return new Error("NXENGINE_PROJECT_INVALID");}
