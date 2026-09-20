// @vitest-environment node
import {expect, it, vi} from "vitest";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {RangeReader} from "./range-reader.js";
import {DEFAULT_FETCH_POLICY} from "./fetch-policy.js";
import {BLOCK_BYTES as B} from "./source.js";

function object(): BlockObject {
  return {key: "game", state: {generation: "one", pinnedEtag: null, revoked: false}, source: {
    identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 8 * B,
    url: "https://example.test/game", purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT",
  }};
}
it("[IO-23] UNIT/logical-hit-bytes counts only copied bytes, including all-or-nothing cached reads", async () => {
  const target = object(), copied = vi.fn(), pool = new BlockPool(0, async () => new Uint8Array(B));
  const reader = new RangeReader("one", target, pool, undefined, copied);
  try {
    await reader.readInto(7, new Uint8Array(13));
    expect(copied.mock.calls).toEqual([["NETWORK", 13]]);
    copied.mockClear(); await reader.readInto(20, new Uint8Array(19));
    expect(copied.mock.calls).toEqual([["MEMORY", 19]]);
    copied.mockClear(); expect(reader.tryReadInto(B - 3, new Uint8Array(5))).toBeNull();
    expect(copied).not.toHaveBeenCalled();
    await reader.readInto(B - 3, new Uint8Array(5));
    expect(copied.mock.calls).toEqual([["MEMORY", 3], ["NETWORK", 2]]);
    copied.mockClear(); expect(reader.tryReadInto(B - 3, new Uint8Array(5))).toBe(5);
    expect(copied.mock.calls).toEqual([["MEMORY", 5]]);
    copied.mockClear(); await reader.readInto(reader.sizeBytes, new Uint8Array());
    expect(copied).not.toHaveBeenCalled();
  } finally {await reader.close(); pool.close();}
});
it("[IO-23] UNIT/logical-hit-bytes retains each block's origin when a shared window mixes backing and network", async () => {
  const target = object(), copied = vi.fn();
  const pool = new BlockPool(0, undefined, undefined, undefined, {
    policy: DEFAULT_FETCH_POLICY, local: async () => null,
    load: async (_object, window, _signal, origins) => {
      origins?.push("NETWORK", "PERSISTENT"); return new Uint8Array(window.length);
    },
  });
  const reader = new RangeReader("one", target, pool, undefined, copied);
  try {
    await Promise.all([reader.readInto(1, new Uint8Array(3)), reader.readInto(B + 7, new Uint8Array(11))]);
    expect(copied.mock.calls).toEqual(expect.arrayContaining([["NETWORK", 3], ["PERSISTENT", 11]]));
    expect(copied).toHaveBeenCalledTimes(2);
  } finally {await reader.close(); pool.close();}
});
it("[IO-23] UNIT/logical-hit-bytes treats verified persistent bytes as a hit and excludes a cancelled waiter", async () => {
  const copied = vi.fn(), target = object();
  const pool = new BlockPool(0, undefined, undefined, undefined, {policy: DEFAULT_FETCH_POLICY,
    local: async () => new Uint8Array(B), load: async () => {throw new Error("unexpected network");}});
  const reader = new RangeReader("one", target, pool, undefined, copied);
  try {
    await reader.readInto(9, new Uint8Array(17));
    expect(copied.mock.calls).toEqual([["PERSISTENT", 17]]);
    copied.mockClear(); const abort = new AbortController(); abort.abort();
    await expect(reader.readInto(0, new Uint8Array(4), abort.signal)).rejects.toThrow("ABORTED");
    expect(copied).not.toHaveBeenCalled();
  } finally {await reader.close(); pool.close();}
});
