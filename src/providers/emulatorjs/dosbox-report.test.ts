import {describe, expect, it, vi} from "vitest";

import {installDOSBoxReportCompatibility} from "./dosbox-report.js";

describe("DOSBox Pure's pinned EmulatorJS report", () => {
  it("converts the 4.3 cache item into verified JSON before the core consumes it", async () => {
    const sha = "a".repeat(64);
    const metadata = {kind: "RETROM_CORE_CANDIDATE_V1", coreId: "dosbox_pure", dirty: false,
      files: [{filename: "dosbox_pure-thread-wasm.data", sha256: sha}]};
    const item = {data: {files: [{bytes: new TextEncoder().encode(JSON.stringify(metadata))}]}, headers: {}};
    const original = vi.fn(async (_path: string, _type: string) => item);
    const instance = {downloadFile: original};
    const cleanup = installDOSBoxReportCompatibility(instance, sha);
    try {
      const path = "cores/reports/dosbox_pure.json?v=497337";
      await expect(instance.downloadFile(path, "Reports")).resolves.toEqual({
        data: {...metadata, buildStart: sha}, headers: {},
      });
      await expect(instance.downloadFile("cores/reports/other.json?v=1", "Reports")).resolves.toBe(item);
      await expect(instance.downloadFile(path, "Core")).resolves.toBe(item);
      original.mockResolvedValueOnce({data: {files: [{bytes: new TextEncoder().encode(JSON.stringify({
        ...metadata, files: [{filename: "dosbox_pure-thread-wasm.data", sha256: "b".repeat(64)}],
      }))}]}, headers: {}});
      await expect(instance.downloadFile(path, "Reports")).rejects.toThrow("PLAYER_DOS_REPORT_INVALID");
    } finally {cleanup();}
    expect(instance.downloadFile).toBe(original);
  });
});
