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

it.each(["openbor-game-save-v1", "openbor-game-save-v1-storage-v1"])("decodes %s and acknowledges only native OpenBOR bytes", async format => {
  const {encodeSave, decodeSave, saveFormat} = await import("../../openbor/save.js");
  const {gzipSync, gunzipSync} = await import("fflate");
  const identity = "a".repeat(64), files = [["game.sav", new Uint8Array(2048).fill(7)]] as const;
  const bytes = encodeSave(identity, files);
  const adapter = adapterFixture({
    checkpoint: async () => ({bytes, format: saveFormat}),
    acknowledgeCheckpoint: vi.fn(async checkpoint => {
      expect(checkpoint.format).toBe(saveFormat);
      expect(decodeSave(checkpoint.bytes, identity)).toEqual(files);
    }),
  });
  vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
  const stored = format === saveFormat ? bytes : gzipSync(bytes);
  const envelope = targetEnvelope("openbor");
  envelope.restore = {format, sizeBytes: stored.length, sha256: identity, url: "/save"};
  const player = createRetromRuntimePlayer(envelope, hostFixture({loadRestore: async () => stored}), {});
  try {
    await player.mount(document.createElement("div"));
    expect(Array.from(vi.mocked(mountTargetAdapter).mock.calls.at(-1)![2].restorePayload!)).toEqual(Array.from(bytes));
    const saved = await player.checkpoint();
    expect(saved.format).toBe("openbor-game-save-v1-storage-v1");
    expect(Array.from(gunzipSync(saved.bytes))).toEqual(Array.from(bytes));
    expect(saved.bytes.length).toBeLessThan(bytes.length / 2);
    expect(adapter.acknowledgeCheckpoint).not.toHaveBeenCalled();
    await player.acknowledgeCheckpoint?.(saved);
    expect(adapter.acknowledgeCheckpoint).toHaveBeenCalledOnce();
  } finally {await player.exit();}
});
