// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {abortable} from "./abort.js";
import {ContentIOError} from "./errors.js";
import {BlockPool, type BlockLoader, type BlockObject} from "./block-pool.js";
import {blockRange} from "./http.js";
import {RangeReader} from "./range-reader.js";
import {BLOCK_BYTES as B} from "./source.js";
const pools: BlockPool[] = [];
const byteAt = (n: number) => (n % 251 + 17 * (Math.floor(n / 251) % 251) + 31 * (Math.floor(n / 65536) % 251) + 17) % 256;
const generated: BlockLoader = async (object, index) => {
  const {start, length} = blockRange(object.source, index);
  const bytes = new Uint8Array(length);
  for (let n = 0; n < length; n++) {bytes[n] = byteAt(start + n);}
  return bytes;
};
function setup(size = 3 * B + 17, loader = generated) {
  const object: BlockObject = {key: "game", state: {generation: "g1", pinnedEtag: null, revoked: false},
    source: {identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: size, url: "https://example.test/game",
      purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", }};
  const load = vi.fn(loader), pool = new BlockPool(0, load); pools.push(pool);
  return {object, pool, load, reader: new RangeReader("one", object, pool), other: new RangeReader("two", object, pool)};
}
afterEach(async () => {
  for (const pool of pools.splice(0)) {pool.close(); await Promise.resolve(); expect(pool.stats).toMatchObject({active: 0, queued: 0, pending: 0, waiters: 0, temporaryBytes: 0, outputBytes: 0});}
  vi.useRealTimers();
});
it("[IO-01] UNIT/reader opens without I/O and accepts only bounded reads", async () => {
  const {reader, load} = setup(); expect(load).not.toHaveBeenCalled();
  expect(reader.tryReadInto(0, new Uint8Array(1))).toBeNull(); expect(load).not.toHaveBeenCalled();
  const output = new Uint8Array(19); expect(await reader.readInto(31, output)).toBe(19);
  expect(output).toEqual(Uint8Array.from({length: 19}, (_, i) => byteAt(31 + i))); expect(load).toHaveBeenCalledTimes(1);
});
it("[IO-02] UNIT/reader [IO-07] UNIT/reader aligns only needed unique blocks and makes try all-or-nothing", async () => {
  const {reader, other, load} = setup(), output = new Uint8Array(50);
  await reader.readInto(B - 25, output); expect(load.mock.calls.map(([, index]) => index)).toEqual([0, 1]);
  expect(other.tryReadInto(B - 25, output)).toBe(50); expect(load).toHaveBeenCalledTimes(2);
  const missing = new Uint8Array(50).fill(199); expect(reader.tryReadInto(2 * B - 25, missing)).toBeNull();
  expect(missing).toEqual(new Uint8Array(50).fill(199));
  await other.readInto(3 * B, new Uint8Array(17)); expect(load.mock.calls.map(([, index]) => index)).toEqual([0, 1, 3]);
});
it("[IO-03] UNIT/reader [IO-04] UNIT/reader zero/EOF/integer checks happen before allocation or cache", async () => {
  const {reader, load} = setup();
  expect(await reader.readInto(reader.sizeBytes, new Uint8Array())).toBe(0);
  for (const offset of [-1, NaN, Infinity, 1.5, reader.sizeBytes + 1]) {await expect(reader.readInto(offset, new Uint8Array())).rejects.toThrow("BOUNDS");}
  await expect(reader.readInto(0, new Uint8Array(16777217))).rejects.toThrow("BOUNDS");
  expect(load).not.toHaveBeenCalled(); await reader.close(); await reader.close();
  await expect(reader.readInto(0, new Uint8Array())).rejects.toThrow("ABORTED");
});
it("[IO-05] UNIT/reader reads sparse offsets above 4GiB without truncation or prefetch", async () => {
  const {reader, load} = setup(5368709243), positions = [0, 4294967327, 5368709200];
  for (const offset of positions) {const bytes = new Uint8Array(17); await reader.readInto(offset, bytes); expect(bytes).toEqual(Uint8Array.from({length: 17}, (_, i) => byteAt(offset + i)));}
  expect(load.mock.calls.map(([, i]) => i)).toEqual([0, 16384, 20480]);
});
it("[IO-06] UNIT/reader [IO-08] UNIT/reader two handles share one cold request with nineteen independent survivors", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {release = resolve;});
  const {reader, other, load} = setup(undefined, async (object, index, signal) => {await abortable(barrier, signal); return generated(object, index, signal);});
  const cancel = new AbortController(), outputs = Array.from({length: 20}, () => new Uint8Array(30));
  const reads = outputs.map((bytes, i) => (i % 2 ? reader : other).readInto(7, bytes, i === 0 ? cancel.signal : undefined));
  const first = expect(reads[0]).rejects.toThrow("ABORTED"); cancel.abort(); await first;
  expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0][2].aborted).toBe(false); release(); await Promise.all(reads.slice(1));
  for (const bytes of outputs.slice(1)) {expect(bytes).toEqual(Uint8Array.from({length: 30}, (_, i) => byteAt(7 + i)));}
  outputs[1].fill(0); expect(outputs[2][0]).toBe(byteAt(7));
});
it("[IO-09] UNIT/reader [IO-10] UNIT/reader close discards late responses and leaves other handles live", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {release = resolve;});
  const {reader, other, pool} = setup(undefined, async (object, index, signal) => {await barrier; return generated(object, index, signal);});
  const bytes = new Uint8Array(8), pending = reader.readInto(0, bytes);
  const rejected = expect(pending).rejects.toThrow("ABORTED"); await reader.close(); await rejected;
  release(); for (let i = 0; i < 12; i++) {await Promise.resolve();}
  expect(bytes).toEqual(new Uint8Array(8)); expect(pool.stats.lruBytes).toBe(0);
  await other.readInto(0, bytes); expect(bytes[0]).toBe(byteAt(0));
});
it("[IO-22] UNIT/reader output mutation and transfer cannot poison or detach LRU", async () => {
  const {reader, other, pool, load} = setup(), output = new Uint8Array(8);
  await reader.readInto(0, output); output[0] = 0; structuredClone(output, {transfer: [output.buffer]});
  const fresh = new Uint8Array(8); expect(other.tryReadInto(0, fresh)).toBe(8); expect(fresh[0]).toBe(byteAt(0));
  await reader.close(); expect(() => reader.tryReadInto(0, fresh)).toThrow("ABORTED");
  pool.close(); expect(() => other.tryReadInto(0, fresh)).toThrow("ABORTED"); expect(load).toHaveBeenCalledTimes(1);
});
it("stream is pull-driven and stopping does not fetch the rest", async () => {
  const {reader, load} = setup();
  for await (const chunk of reader.stream(7, reader.sizeBytes - 7)) {expect(chunk.length).toBe(B - 7); break;}
  expect(load).toHaveBeenCalledTimes(1);
});
it("[IO-24] UNIT/reader [X-04] UNIT/reader multi-block reads share a single logical deadline", async () => {
  vi.useFakeTimers();
  const {reader} = setup(undefined, async (object, index, signal) => {
    await abortable(new Promise<void>((resolve) => setTimeout(resolve, 8000)), signal); return generated(object, index, signal);
  });
  const pending = reader.readInto(0, new Uint8Array(B + 1));
  const rejected = expect(pending).rejects.toThrow("TIMEOUT"); await vi.advanceTimersByTimeAsync(15000); await rejected;
});
it("[IO-02] UNIT/random-trace checks 10,000 deterministic reads and cache budget byte-for-byte", async () => {
  const {reader, pool} = setup(80 * B + 17);
  let state = 13821;
  const random = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state;};
  for (let i = 0; i < 10000; i++) {
    const length = random() % 103, offset = random() % (reader.sizeBytes - length + 1), bytes = new Uint8Array(length);
    await reader.readInto(offset, bytes);
    for (let n = 0; n < length; n++) {if (bytes[n] !== byteAt(offset + n)) {throw new Error(`trace ${i} byte ${n}`);}}
    expect(pool.stats.lruBytes).toBeLessThanOrEqual(16 * 1024 * 1024); expect(pool.stats.temporaryBytes).toBe(0);
  }
}, 30000);

it("[X-21] UNIT/reader-revocation preserves the first object failure in pending and cached reads", async () => {
  let begun!: () => void;
  const started = new Promise<void>(resolve => {begun = resolve;});
  const {reader} = setup(undefined, async (_object, _index, signal) => {
    begun(); return abortable(new Promise<Uint8Array<ArrayBuffer>>(() => {}), signal);
  });
  const pending = reader.readInto(0, new Uint8Array(1));
  const rejected = expect(pending).rejects.toThrow("IDENTITY_CHANGED");
  await started;
  await reader.close(new ContentIOError("IDENTITY_CHANGED"));
  await reader.close(); await rejected;
  for (const size of [0, 1]) {
    expect(() => reader.tryReadInto(0, new Uint8Array(size))).toThrow("IDENTITY_CHANGED");
  }
});
