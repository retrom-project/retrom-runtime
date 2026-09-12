import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";

export const neoCDRangeBlockSize = 256 * 1024;
const memoryLimit = 64;
type Disc = {url: string; sizeBytes: number; sha256: string};
type BlockCache = Pick<Cache, "match" | "put" | "delete">;
type Options = {cache(): Promise<BlockCache | null>; fetcher: typeof fetch};
const invalid = () => new Error("NEOCD_RANGE_INVALID");
const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

/** A single immutable CHD: no construction-time download, 256 KiB blocks, 16 MiB LRU. */
export function createNeoCDRange(disc: Disc, signal: AbortSignal, fail: (error: Error) => void,
  options: Options = {cache: async () => {try {return await caches.open("retrom-neocd-range-v1");} catch {return null;}}, fetcher: fetch},
) {
  return new NeoCDRange(disc, signal, fail, options);
}
class NeoCDRange {
  readonly filename: string;
  private readonly controller = new AbortController();
  private readonly memory = new Map<number, Uint8Array>();
  private readonly pending = new Map<number, Promise<Uint8Array>>();
  private readonly waiters = new Set<() => void>();
  private readonly cache: Promise<BlockCache | null>;
  private suspended = 0;
  private readonly abort = () => this.controller.abort();
  constructor(private readonly disc: Disc, private readonly signal: AbortSignal,
    private readonly onError: (error: Error) => void, private readonly options: Options) {
    if (!/^[a-f0-9]{64}$/u.test(disc.sha256) || !Number.isSafeInteger(disc.sizeBytes) || disc.sizeBytes < 1 || disc.sizeBytes > 2 ** 31 - 1) {throw invalid();}
    this.filename = `${disc.sha256}.chd`;
    signal.throwIfAborted(); signal.addEventListener("abort", this.abort, {once: true});
    this.cache = options.cache().catch(() => null);
  }
  fail(error: Error) {if (!this.controller.signal.aborted) {this.onError(error);}}
  get memoryBytes() {return [...this.memory.values()].reduce((sum, bytes) => sum + bytes.length, 0);}
  begin() {++this.suspended;}
  end() {if (--this.suspended === 0) {for (const resolve of this.waiters) {resolve();} this.waiters.clear();}}
  idle() {return this.suspended ? new Promise<void>(resolve => this.waiters.add(resolve)) : Promise.resolve();}
  async dispose() {
    this.abort(); this.signal.removeEventListener("abort", this.abort);
    await this.idle(); this.memory.clear();
  }
  read(position: number, length: number): Uint8Array | Promise<Uint8Array> {
    this.controller.signal.throwIfAborted();
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 1 ||
      length > neoCDRangeBlockSize || position > this.disc.sizeBytes - length) {throw new Error("NEOCD_RANGE_READ_INVALID");}
    const start = Math.floor(position / neoCDRangeBlockSize) * neoCDRangeBlockSize;
    const cached = this.memory.get(start), offset = position - start;
    if (cached && offset + length <= cached.length) {
      this.memory.delete(start); this.memory.set(start, cached);
      return cached.subarray(offset, offset + length);
    }
    return this.readBlocks(position, length);
  }
  private async readBlocks(position: number, length: number) {
    const result = new Uint8Array(length);
    let copied = 0;
    while (copied < length) {
      this.controller.signal.throwIfAborted();
      const start = Math.floor((position + copied) / neoCDRangeBlockSize) * neoCDRangeBlockSize;
      const bytes = await this.block(start), offset = position + copied - start;
      const count = Math.min(bytes.length - offset, length - copied);
      result.set(bytes.subarray(offset, offset + count), copied); copied += count;
    }
    return result;
  }
  private block(start: number): Promise<Uint8Array> {
    const bytes = this.memory.get(start);
    if (bytes) {this.memory.delete(start); this.memory.set(start, bytes); return Promise.resolve(bytes);}
    const pending = this.pending.get(start); if (pending) {return pending;}
    const request = this.fetchBlock(start).then(bytes => {
      this.controller.signal.throwIfAborted();
      this.memory.set(start, bytes);
      if (this.memory.size > memoryLimit) {this.memory.delete(this.memory.keys().next().value!);}
      return bytes;
    }).finally(() => this.pending.delete(start));
    this.pending.set(start, request); return request;
  }
  private async fetchBlock(start: number) {
    const size = Math.min(neoCDRangeBlockSize, this.disc.sizeBytes - start), end = start + size - 1;
    const key = `https://retrom-runtime.invalid/neocd-range-v1/${this.disc.sha256}/${this.disc.sizeBytes}/${start}`;
    const cache = await this.cache;
    try {
      const hit = await cache?.match(key);
      if (hit) {
        const bytes = await boundedBytes(hit, size, this.controller.signal);
        if (digest(bytes) !== hit.headers.get("X-Retrom-Block-SHA256")) {throw invalid();}
        return bytes;
      }
    } catch {try {await cache?.delete(key);} catch { /* Persistence is optional. */ }}
    this.controller.signal.throwIfAborted();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(20_000)]);
    const fetcher = this.options.fetcher;
    const response = await fetcher(this.disc.url, {signal, headers: {
      Range: `bytes=${start}-${end}`, "If-Range": `"sha256-${this.disc.sha256}"`,
    }});
    if (response.status !== 206 || response.headers.get("Content-Range") !== `bytes ${start}-${end}/${this.disc.sizeBytes}` ||
      response.headers.get("ETag") !== `"sha256-${this.disc.sha256}"`) {
      await response.body?.cancel().catch(() => {}); throw invalid();
    }
    const bytes = await boundedBytes(response, size, signal);
    try {await cache?.put(key, new Response(bytes.slice(), {headers: {"X-Retrom-Block-SHA256": digest(bytes)}}));}
    catch { /* Keep using bounded network reads when persistence is unavailable. */ }
    return bytes;
  }
}
async function boundedBytes(response: Response, expected: number, signal: AbortSignal) {
  const reader = response.body?.getReader(); if (!reader) {throw invalid();}
  const bytes = new Uint8Array(expected); let loaded = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const {value, done} = await reader.read(); if (done) {break;}
      if (value.length > expected - loaded) {throw invalid();}
      bytes.set(value, loaded); loaded += value.length;
    }
    if (loaded !== expected) {throw invalid();} return bytes;
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
}
