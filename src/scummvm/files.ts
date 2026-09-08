export const blockSize = 256 * 1024;
const memoryBlocks = 64;
type Entry = {path: string; sizeBytes: number; url: string};
export type BlockCache = {
  match(key: string): Promise<Response | null | undefined>;
  put(key: string, value: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
};

/** A file index plus bounded, persistent HTTP blocks. Construction never fetches game data. */
export class ScummvmFiles {
  private readonly entries = new Map<string, Entry>();
  private readonly directories = new Map<string, Set<string>>();
  private readonly memory = new Map<string, Uint8Array>();
  private readonly pending = new Map<string, Promise<Uint8Array>>();

  constructor(
    index: unknown,
    private readonly contentDigest: string,
    private readonly fetcher: typeof fetch,
    private readonly cache: BlockCache | null,
    private readonly signal?: AbortSignal,
    private readonly mountRoot: "/game" | "/data" = "/game",
  ) {
    if (!/^[0-9a-f]{64}$/u.test(contentDigest)) {throw indexError();}
    this.directories.set(mountRoot, new Set());
    const seen = new Set<string>();
    for (const entry of parseIndex(index)) {
      const path = `${this.mountRoot}/${entry.path}`;
      const folded = path.toLowerCase();
      if (seen.has(folded)) {throw indexError();}
      seen.add(folded);
      this.entries.set(path, entry);
      this.addDirectories(path);
    }
    for (const path of this.directories.keys()) {
      if (seen.has(path.toLowerCase())) {throw indexError();}
    }
  }

  stat(path: string) {return this.entries.get(path)?.sizeBytes ?? (this.directories.has(path) ? -1 : -2);}
  list(path: string) {return [...this.directories.get(path) ?? []].sort();}

  async read(path: string, position: number, length: number): Promise<Uint8Array> {
    this.signal?.throwIfAborted();
    const entry = this.entries.get(path);
    if (!entry || !Number.isSafeInteger(position) || !Number.isSafeInteger(length) ||
      position < 0 || length < 0 || length > blockSize || position > entry.sizeBytes - length) {
      throw new Error("SCUMMVM_READ_INVALID");
    }
    const result = new Uint8Array(length);
    let copied = 0;
    while (copied < length) {
      const start = Math.floor((position + copied) / blockSize) * blockSize;
      const bytes = await this.block(entry, start);
      const offset = position + copied - start;
      const count = Math.min(bytes.length - offset, length - copied);
      result.set(bytes.subarray(offset, offset + count), copied);
      copied += count;
    }
    return result;
  }

  private addDirectories(path: string) {
    const parts = path.split("/");
    for (let end = 2; end < parts.length; ++end) {
      const parent = parts.slice(0, end).join("/");
      const children = this.directories.get(parent) ?? new Set<string>();
      children.add(parts[end]);
      this.directories.set(parent, children);
    }
  }

  private block(entry: Entry, start: number): Promise<Uint8Array> {
    const key = `https://retrom-runtime.invalid/scummvm-blocks-v1/${this.contentDigest}/${encodeURIComponent(entry.path)}/${entry.sizeBytes}/${start}`;
    const remembered = this.memory.get(key);
    if (remembered) {
      this.memory.delete(key); this.memory.set(key, remembered);
      return Promise.resolve(remembered);
    }
    const existing = this.pending.get(key);
    if (existing) {return existing;}
    const pending = this.fetchBlock(key, entry, start).then((bytes) => {
      this.memory.set(key, bytes);
      if (this.memory.size > memoryBlocks) {this.memory.delete(this.memory.keys().next().value!);}
      return bytes;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }

  private async fetchBlock(key: string, entry: Entry, start: number) {
    const length = Math.min(blockSize, entry.sizeBytes - start);
    const cached = await this.cachedBlock(key, length);
    if (cached) {return cached;}
    this.signal?.throwIfAborted();
    const end = start + length - 1;
    const fetcher = this.fetcher;
    const response = await fetcher(entry.url, {headers: {Range: `bytes=${start}-${end}`}, signal: this.signal});
    const partial = response.status === 206 && response.headers.get("Content-Range") === `bytes ${start}-${end}/${entry.sizeBytes}`;
    const completeSmallFile = response.status === 200 && start === 0 && length === entry.sizeBytes;
    if (!partial && !completeSmallFile) {
      await response.body?.cancel().catch(() => undefined);
      throw rangeError();
    }
    const bytes = await boundedBytes(response, length);
    try {await this.cache?.put(key, new Response(bytes.slice()));} catch { /* Network data remains usable. */ }
    return bytes;
  }

  private async cachedBlock(key: string, length: number) {
    try {
      const response = await this.cache?.match(key);
      if (response) {return await boundedBytes(response, length);}
    } catch {
      try {await this.cache?.delete(key);} catch { /* Persistence is optional. */ }
    }
    return null;
  }
}

export async function openScummvmBlockCache(frameWindow: Window): Promise<BlockCache | null> {
  try {return await frameWindow.caches.open("retrom-runtime-scummvm-blocks-v1");} catch {return null;}
}

async function boundedBytes(response: Response, expected: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {throw rangeError();}
  const result = new Uint8Array(expected);
  let loaded = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) {break;}
      if (value.byteLength > expected - loaded) {throw rangeError();}
      result.set(value, loaded); loaded += value.byteLength;
    }
    if (loaded !== expected) {throw rangeError();}
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
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
function rangeError() {return new Error("SCUMMVM_RANGE_INVALID");}
