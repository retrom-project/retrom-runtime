import {expect, it, vi} from "vitest";
import {ContentGC} from "./gc.js";
import type {ContentMetadata} from "./metadata.js";
import type {ContentLocks} from "./locks.js";

it("retains complete files and old valid partial blocks under storage pressure", async () => {
  const candidates = ["COMPLETE", "PARTIAL"].map((state, index) => ({key: String(index), state,
    lastAccessMs: 0, committedBytes: 10 * 1024 ** 3, revision: 1}));
  const gcLock = vi.fn(async () => 1);
  const metadata = {list: async () => candidates, totalBytes: async () => 20 * 1024 ** 3} as unknown as ContentMetadata;
  vi.stubGlobal("navigator", {storage: {estimate: async () => ({quota: 1})}});
  try {
    expect(await new ContentGC(metadata, {gc: gcLock} as unknown as ContentLocks, []).collect()).toBe(0);
    expect(gcLock).not.toHaveBeenCalled();
  } finally {vi.unstubAllGlobals();}
});
