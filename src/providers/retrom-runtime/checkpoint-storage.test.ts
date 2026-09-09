import {describe, expect, it, vi} from "vitest";
import {adapterFixture, hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {targetEnvelope} from "../../../tests/provider-fixtures.js";
import {createRetromRuntimePlayer} from "./provider-runtime.js";
import {mountTargetAdapter} from "./target-adapter.js";
vi.mock("./target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));

describe("shared checkpoint storage boundary", () => {
  it("stores a large native snapshot compactly and restores the exact adapter bytes", async () => {
    const bytes = new Uint8Array(512 * 1024 + 1); bytes[bytes.length - 1] = 19;
    const adapter = adapterFixture({checkpoint: async () => ({bytes, format: "np2kai-state-v1"})});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const envelope = targetEnvelope("np2kai-pc98"); envelope.restore = null;
    const player = createRetromRuntimePlayer(envelope, hostFixture(), {});
    await player.mount(document.createElement("div"));
    try {
      const saved = await player.checkpoint();
      expect(saved.bytes.byteLength).toBeLessThan(bytes.byteLength / 10);
      expect(saved.format).toBe("np2kai-state-v1-storage-v1");
      const next = targetEnvelope("np2kai-pc98");
      next.restore = {format: saved.format, sizeBytes: saved.bytes.length, sha256: "a".repeat(64), url: "/save"};
      const restored = createRetromRuntimePlayer(next, hostFixture({loadRestore: async () => saved.bytes}), {});
      try {
        await restored.mount(document.createElement("div"));
        expect(vi.mocked(mountTargetAdapter).mock.calls.at(-1)![2].restorePayload).toEqual(bytes);
      } finally {await restored.exit();}
    } finally {await player.exit();}
  });
});
