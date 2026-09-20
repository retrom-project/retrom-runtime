import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import {ContentIOError} from "../content-io/errors.js";
import {contentLimits} from "../content-io/limits.js";
import {rangePolicy} from "../provider/content-policies.js";
export const blockSize = 256 * 1024;
type Entry = {path: string; sizeBytes: number; url: string};
export type ScummvmFileSession = Pick<AdapterContentSession, "open">;
/** Index/FS semantics only. Reader handles are lazy; stat/list never fetch or open content. */
export class ScummvmFiles {
  private readonly entries = new Map<string, Entry>();
  private readonly directories = new Map<string, Set<string>>();
  private readonly readers = new Map<string, Promise<ContentReaderV1>>();
  private closed = false;
  constructor(index: unknown, private readonly contentDigest: string, private readonly session: ScummvmFileSession,
    private readonly signal?: AbortSignal, private readonly mountRoot: "/game" | "/data" = "/game",
    private readonly verifiedAssets?: ReadonlyMap<string, string>) {
    if (!/^[0-9a-f]{64}$/u.test(contentDigest) || (mountRoot === "/data") !== Boolean(verifiedAssets)) {throw indexError();}
    this.directories.set(mountRoot, new Set()); const seen = new Set<string>();
    for (const entry of parseIndex(index)) {
      if (entry.sizeBytes > contentLimits.indexedFile || verifiedAssets && !verifiedAssets.has(entry.path)) {throw indexError();}
      const path = `${mountRoot}/${entry.path}`, folded = path.toLowerCase();
      if (seen.has(folded)) {throw indexError();} seen.add(folded);
      this.entries.set(path, entry); this.addDirectories(path);
    }
    for (const path of this.directories.keys()) {if (seen.has(path.toLowerCase())) {throw indexError();}}
  }
  stat(path: string) {return this.entries.get(path)?.sizeBytes ?? (this.directories.has(path) ? -1 : -2);}
  list(path: string) {return [...this.directories.get(path) ?? []].sort();}
  async read(path: string, position: number, length: number): Promise<Uint8Array> {
    this.check(); const entry = this.entries.get(path);
    if (!entry || !Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 ||
      length > blockSize || position > entry.sizeBytes - length) {throw new ContentIOError("BOUNDS");}
    const reader = await this.reader(entry); this.check(); const result = new Uint8Array(length);
    await reader.readInto(position, result, this.signal); this.check(); return result;
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.readers.values()].map(async (pending) => {const reader = await pending.catch(() => null); await reader?.close();}));
    this.readers.clear();
  }
  private check() {if (this.closed || this.signal?.aborted) {throw new ContentIOError("ABORTED");}}
  private reader(entry: Entry): Promise<ContentReaderV1> {
    const found = this.readers.get(entry.path); if (found) {return found;}
    const policy = rangePolicy("ASYNC", contentLimits.indexedFile, {});
    const sha256 = this.verifiedAssets?.get(entry.path);
    const pending = this.session.open({identity: sha256 ? {kind: "FILE_SHA256", sha256} :
      {kind: "INDEX_ENTRY", projectDigest: this.contentDigest, logicalPath: entry.path},
    sizeBytes: entry.sizeBytes, url: entry.url, purpose: sha256 ? "CORE_ASSET" : "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: sha256 ? "IMMUTABLE_ASSET" : "PIN_STRONG", contentLengthPolicy: policy.contentLengthPolicy,
    }, policy, this.signal).then(async reader => {
      if (this.closed) {await reader.close(); throw new ContentIOError("ABORTED");} return reader;
    });
    this.readers.set(entry.path, pending);
    void pending.catch(() => {if (this.readers.get(entry.path) === pending) {this.readers.delete(entry.path);}});
    return pending;
  }
  private addDirectories(path: string) {
    const parts = path.split("/");
    for (let end = 2; end < parts.length; ++end) {
      const parent = parts.slice(0, end).join("/"), children = this.directories.get(parent) ?? new Set<string>();
      children.add(parts[end]); this.directories.set(parent, children);
    }
  }
}
function parseIndex(value: unknown): Entry[] {
  if (!value || typeof value !== "object") {throw indexError();}
  const index = value as {schemaVersion?: unknown; files?: unknown};
  if (index.schemaVersion !== 1 || !Array.isArray(index.files) || !index.files.length || index.files.length > 100_000) {
    throw indexError();
  }
  return index.files.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") {throw indexError();}
    const entry = raw as Partial<Entry>;
    if (typeof entry.path !== "string" || !safePath(entry.path) || !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes! < 0 || typeof entry.url !== "string") {throw indexError();}
    const url = new URL(entry.url, globalThis.location?.href ?? "https://retrom-runtime.invalid/");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {throw indexError();}
    return {path: entry.path, url: url.href, sizeBytes: entry.sizeBytes!};
  });
}

function safePath(path: string) {
  return path.length <= 4096 && !path.includes("\\") && [...path].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
    path.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}
function indexError() {return new Error("SCUMMVM_INDEX_INVALID");}
