// @vitest-environment node
import {expect, it} from "vitest";
import {controls, createSyncBuffer} from "./bridge/blocking.js";
import {readSyncMetrics, writeSyncMetrics} from "./sync-metrics.js";
it("[IO-23] UNIT/sync-metrics retains safe-integer counters across 32-bit boundaries and rejects torn updates", () => {
  const control = controls(createSyncBuffer(1));
  for (const memoryHitBytes of [0, 2147483648, 4294967303, Number.MAX_SAFE_INTEGER]) {
    const value = {memoryHitBytes, persistentHitBytes: Number.MAX_SAFE_INTEGER - memoryHitBytes, cacheBytesL1: 17, peakCacheBytesL1: 262144};
    writeSyncMetrics(control, value); expect(readSyncMetrics(control)).toEqual(value);
  }
  Atomics.add(control, 9, 1); expect(readSyncMetrics(control)).toBeNull();
  Atomics.add(control, 9, 1); Atomics.store(control, 11, -1);
  expect(() => readSyncMetrics(control)).toThrow("ABI_MISMATCH");
});
it("[IO-23] UNIT/sync-metrics rejects invalid counters before beginning an update", () => {
  const control = controls(createSyncBuffer(1));
  for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => writeSyncMetrics(control, {memoryHitBytes: value, persistentHitBytes: 0, cacheBytesL1: 0, peakCacheBytesL1: 0})).toThrow("CAPACITY_EXCEEDED");
    expect(Atomics.load(control, 9)).toBe(0);
  }
});
