import {expect, it} from "vitest";
import {DEFAULT_FETCH_POLICY, MAX_FETCH_BYTES, fetchWindow, missingRanges, validateFetchPolicy} from "./fetch-policy.js";
import {BLOCK_BYTES as B} from "./source.js";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {RangeReader} from "./range-reader.js";

const M = 1024 * 1024;
it("uses a 2 MiB network window independently of the inclusive 5 MiB small-file threshold", () => {
  expect(DEFAULT_FETCH_POLICY).toEqual({smallFileThresholdBytes: 5 * M, networkWindowBytes: 2 * M});
  expect(MAX_FETCH_BYTES).toBe(2 * M);
  const policy = validateFetchPolicy();
  for (const size of [5 * M - 1, 5 * M, 5 * M + 1]) {
    const window = fetchWindow(size, 0, policy);
    expect(window.wholeFile).toBe(size <= 5 * M);
    expect(window.length).toBe(size <= 5 * M ? size : 2 * M);
  }
  expect(() => validateFetchPolicy({networkWindowBytes: 2 * M + B})).toThrow("SOURCE_INVALID");
  expect(() => validateFetchPolicy({smallFileThresholdBytes: 5 * M + 1})).toThrow("SOURCE_INVALID");
});
it("resumes a partly cached 5 MiB file with bounded missing ranges", () => {
  const window = {start: 0, length: 5 * M, firstBlock: 0, blockCount: 20, wholeFile: true};
  expect(missingRanges(window, new Set([0]))).toEqual([
    {start: B, length: 2 * M}, {start: B + 2 * M, length: 2 * M}, {start: B + 4 * M, length: M - B},
  ]);
});
it("prefetches a 2 MiB successor only after a successful read crosses the half-window boundary", async () => {
  const object: BlockObject = {key: "game", state: {generation: "one", pinnedEtag: null, revoked: false},
    source: {identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 10 * M, url: "https://example.test/game",
      purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}};
  const starts: number[] = [];
  const pool = new BlockPool(0, undefined, undefined, undefined, {policy: DEFAULT_FETCH_POLICY,
    local: async () => null, load: async (_object, window) => {starts.push(window.start); return new Uint8Array(window.length);}});
  const reader = new RangeReader("test", object, pool);
  const tick = async () => {for (let i = 0; i < 30; i++) {await Promise.resolve();}};
  try {
    await reader.readInto(M - 1, new Uint8Array(1)); await tick();
    expect(starts).toEqual([0]);
    await reader.readInto(M, new Uint8Array(1)); await tick();
    expect(starts).toEqual([0, 2 * M]);
    await reader.readInto(M + 1, new Uint8Array(1)); await tick();
    expect(starts).toEqual([0, 2 * M]);
    await reader.readInto(3 * M, new Uint8Array(1)); await tick();
    expect(starts).toEqual([0, 2 * M, 4 * M]);
  } finally {await reader.close(); pool.close(); await tick();}
});
