// @vitest-environment node
import {expect, it, vi} from "vitest";
import {BlockPool, type BlockObject} from "./block-pool.js";
import {ContentIOError} from "./errors.js";
import {DEFAULT_FETCH_POLICY} from "./fetch-policy.js";
import {RangeReader} from "./range-reader.js";
const B = 262144;
for (const point of ["prepare", "local"] as const) {
  it(`[X-21] UNIT/window-${point} identity failure revokes all readers and evicts cached bytes once`, async () => {
    const object: BlockObject = {key: "object", state: {generation: "one", pinnedEtag: null, revoked: false},
      source: {identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: B * 4, url: "https://example.test/file",
        purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}};
    const notify = vi.fn(), fail = async () => {throw new ContentIOError("IDENTITY_CHANGED");};
    const pool = new BlockPool(0, undefined, notify, point === "prepare" ? fail : undefined,
      {policy: DEFAULT_FETCH_POLICY, local: fail, load: vi.fn()});
    const a = new RangeReader("a", object, pool), b = new RangeReader("b", object, pool);
    pool.cache.put(pool.key(object, 0), new Uint8Array(B));
    try {
      await expect(a.readInto(B, new Uint8Array(1))).rejects.toThrow("IDENTITY_CHANGED");
      expect(() => b.tryReadInto(0, new Uint8Array(1))).toThrow("IDENTITY_CHANGED");
      expect(() => b.tryReadInto(0, new Uint8Array(0))).toThrow("IDENTITY_CHANGED");
      expect(pool.stats.lruBytes).toBe(0); expect(notify).toHaveBeenCalledTimes(1);
      expect(pool.stats.temporaryBytes).toBe(0);
    } finally {pool.close();}
  });
}
