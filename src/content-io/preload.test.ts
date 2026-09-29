// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {ContentPreloader} from "./preload.js";

afterEach(() => vi.unstubAllGlobals());

it("refuses to download when persistent storage is unavailable", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const loader = new ContentPreloader({storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]});
  const report = vi.fn();
  try {
    await expect(loader.prepare([{
      identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 3,
      url: "https://example.test/game", purpose: "GAME", transport: "RANGE_REQUIRED",
      etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT",
    }], report)).rejects.toThrow("CONTENT_IO_CACHE_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
    expect(report.mock.calls.every(([loaded]) => loaded === 0)).toBe(true);
  } finally {loader.close();}
});

it("cancellation before preparation performs no fetch or completion", async () => {
  const loader = new ContentPreloader({storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]});
  loader.close();
  await expect(loader.prepare([], vi.fn())).rejects.toThrow("CONTENT_IO_ABORTED");
});
