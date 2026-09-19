import {expect, it} from "vitest";
import {DEFAULT_FETCH_POLICY, MAX_FETCH_BYTES, fetchWindow, missingRanges, validateFetchPolicy} from "./fetch-policy.js";
import {BLOCK_BYTES as B} from "./source.js";

it("[IO-02] UNIT/fetch-config validates and freezes independent settings before I/O", () => {
  expect(validateFetchPolicy()).toEqual(DEFAULT_FETCH_POLICY);
  const input = {smallFileThresholdBytes: B + 17, networkWindowBytes: 3 * B}, policy = validateFetchPolicy(input);
  input.networkWindowBytes = B; expect(policy.networkWindowBytes).toBe(3 * B); expect(Object.isFrozen(policy)).toBe(true);
  expect(validateFetchPolicy({smallFileThresholdBytes: 0}).smallFileThresholdBytes).toBe(0);
  for (const value of [null, [], {extra: 1}, {networkWindowBytes: undefined}, {networkWindowBytes: B - 1},
    {networkWindowBytes: B + 1}, {networkWindowBytes: MAX_FETCH_BYTES + B}, {smallFileThresholdBytes: -1},
    {smallFileThresholdBytes: MAX_FETCH_BYTES + 1}, {smallFileThresholdBytes: 1.5}, {smallFileThresholdBytes: NaN},
    {smallFileThresholdBytes: Infinity}, {networkWindowBytes: Number.MAX_SAFE_INTEGER + 1}]) {
    expect(() => validateFetchPolicy(value)).toThrow("SOURCE_INVALID");
  }
});

for (const windowBytes of [B, 3 * B, 5 * B, MAX_FETCH_BYTES]) {
  for (const threshold of [0, B + 17, DEFAULT_FETCH_POLICY.smallFileThresholdBytes]) {
    it(`[IO-02] UNIT/window-${windowBytes}-threshold-${threshold} plans exact boundaries and holes`, () => {
      const policy = validateFetchPolicy({smallFileThresholdBytes: threshold, networkWindowBytes: windowBytes});
      for (const size of new Set([Math.max(1, threshold - 1), Math.max(1, threshold), threshold + 1, 4 * windowBytes + 17])) {
        for (const index of new Set([0, Math.floor((size - 1) / B), Math.min(Math.floor(windowBytes / B), Math.floor((size - 1) / B))])) {
          const plan = fetchWindow(size, index, policy);
          expect(plan.wholeFile).toBe(size <= threshold);
          expect(plan.start).toBe(size <= threshold ? 0 : Math.floor(index * B / windowBytes) * windowBytes);
          expect(plan.length).toBe(Math.min(size - plan.start, size <= threshold ? size : windowBytes));
          const present = new Set(Array.from({length: plan.blockCount}, (_, n) => plan.firstBlock + n).filter(n => n % 2 === 0));
          const ranges = missingRanges(plan, present);
          expect(ranges.reduce((n, range) => n + range.length, 0)).toBe(
            Array.from({length: plan.blockCount}, (_, n) => plan.firstBlock + n).filter(n => !present.has(n))
              .reduce((total, n) => total + Math.min(B, size - n * B), 0));
          for (const range of ranges) {
            expect(range.start).toBeGreaterThanOrEqual(plan.start); expect(range.start + range.length).toBeLessThanOrEqual(plan.start + plan.length);
            for (let offset = range.start; offset < range.start + range.length; offset += B) {expect(present.has(offset / B)).toBe(false);}
          }
          expect(missingRanges(plan, new Set())).toEqual([{start: plan.start, length: plan.length}]);
          expect(missingRanges(plan, new Set(Array.from({length: plan.blockCount}, (_, n) => plan.firstBlock + n)))).toEqual([]);
        }
      }
    });
  }
}
it("[IO-05] UNIT/window-safe-offset preserves offsets near the safe integer limit", () => {
  const size = Number.MAX_SAFE_INTEGER, index = Math.floor((size - 1) / B);
  const plan = fetchWindow(size, index, validateFetchPolicy({networkWindowBytes: 3 * B}));
  expect(plan.start + plan.length - 1).toBe(size - 1);
  for (const index of [-1, 1.5, NaN, Math.ceil(size / B)]) {expect(() => fetchWindow(size, index, DEFAULT_FETCH_POLICY)).toThrow("BOUNDS");}
  expect(() => fetchWindow(0, 0, DEFAULT_FETCH_POLICY)).toThrow("BOUNDS");
});
