// @vitest-environment node
import {expect, it} from "vitest";
import {base, parseMessage} from "./protocol.js";
const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
const diagnostic = (counts: Record<string, number>, operation = "READ") => ({...base(address, 0), type: "DIAGNOSTIC", codeNumber: 0, objectKey: null, operation, counts});
it("[X-29] UNIT/diagnostic-metrics accepts nonnegative fractional durations but only integral byte and resource counts", () => {
  const value = diagnostic({firstFrameMs: 1.25, inputReadyMs: 8.5, exitMs: 0.125, networkBytes: 17, rangeRequests: 1, cacheBytesL2: 17, peakTemporaryBytes: 262144});
  expect(parseMessage(value, address)).toEqual(value);
  const invalid: Record<string, number>[] = [{firstFrameMs: NaN}, {exitMs: Infinity}, {inputReadyMs: -1}, {networkBytes: 1.5}, {rangeRequests: Number.MAX_SAFE_INTEGER + 1}, {unknown: 0}];
  for (const counts of invalid) {
    expect(() => parseMessage(diagnostic(counts), address)).toThrow("SOURCE_INVALID");
  }
});
it("[X-29] UNIT/diagnostic-metrics keeps informational success distinct from numeric errors and rejects unknown operations", () => {
  for (const operation of ["CACHE_PROBE", "CACHE_READ", "CACHE_WRITE", "CACHE_GC", "CACHE_DEGRADE", "READ", "MATERIALIZE", "CLOSE", "ABI"]) {
    expect(parseMessage(diagnostic({}, operation), address).type).toBe("DIAGNOSTIC");
  }
  for (const operation of ["BACKEND", "UNLISTED"]) {expect(() => parseMessage(diagnostic({}, operation), address)).toThrow("SOURCE_INVALID");}
  for (const codeNumber of [-1, 18, 0.5]) {expect(() => parseMessage({...diagnostic({}), codeNumber}, address)).toThrow("SOURCE_INVALID");}
});
