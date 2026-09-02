import { describe, expect, it, vi } from "vitest";

import { GameRuntimeController } from "./controller.js";
import { runtimeAdapters } from "./catalog.js";
import type {
  CheckpointAvailability,
  GameRuntimeEvent,
  RuntimeCapabilities,
  RuntimeCheckpoint,
} from "./contract.js";
import type { MountedRuntimeAdapter } from "./internal-adapter.js";

const capabilities: RuntimeCapabilities = {
  checkpoint: true,
  contentSources: ["FILE_TREE_V1"],
  frameCounter: false,
  pause: true,
  screenshot: true,
  standardGamepad: true,
  validationProbes: ["test.counter.v1"],
  volume: false,
};

function adapterFixture(overrides: Partial<MountedRuntimeAdapter> = {}): MountedRuntimeAdapter {
  const availability: CheckpointAvailability = { available: true, blocker: null };
  return {
    checkpoint: vi.fn(async (): Promise<RuntimeCheckpoint> => ({
      bytes: Uint8Array.of(1, 2, 3), format: "test-checkpoint-v1",
    })),
    exit: vi.fn(async () => undefined),
    getCanvas: () => null,
    getCheckpointAvailability: () => availability,
    getFrameCount: () => null,
    getValidationProbe: (kind) => kind === "test.counter.v1"
      ? { kind, schemaVersion: 1, value: { counter: 7 } }
      : null,
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Blob([Uint8Array.of(1)], { type: "image/png" })),
    setVolume: null,
    ...overrides,
  };
}

describe("engine-neutral runtime contract", () => {
  it("runs a non-RPG adapter through the shared lifecycle without a fake generation or position", async () => {
    const adapter = adapterFixture();
    const events: GameRuntimeEvent[] = [];
    const runtime = new GameRuntimeController(async () => adapter, capabilities, null);
    runtime.subscribe((event) => events.push(event));

    await runtime.mount(document.createElement("div"));
    expect(runtime.getCapabilities()).toEqual(capabilities);
    expect(runtime.getValidationProbe("test.counter.v1")).toEqual({
      kind: "test.counter.v1", schemaVersion: 1, value: { counter: 7 },
    });
    expect(await runtime.checkpoint()).toEqual({
      bytes: Uint8Array.of(1, 2, 3), format: "test-checkpoint-v1",
    });
    expect(events).toContainEqual({ type: "READY" });
    await runtime.exit();
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("uses generic checkpoint blockers and errors", async () => {
    const checkpoint = vi.fn(async (): Promise<RuntimeCheckpoint> => ({
      bytes: Uint8Array.of(1), format: "test-checkpoint-v1",
    }));
    const runtime = new GameRuntimeController(async () => adapterFixture({
      checkpoint,
      getCheckpointAvailability: () => ({ available: false, blocker: "BUSY" }),
    }), capabilities, null);
    await runtime.mount(document.createElement("div"));

    await expect(runtime.checkpoint()).rejects.toThrow("CHECKPOINT_UNAVAILABLE");
    expect(checkpoint).not.toHaveBeenCalled();
    await runtime.exit();
  });

  it("registers every adapter through one engine-neutral catalog", () => {
    expect(runtimeAdapters.map((entry) => entry.adapterKind).sort()).toEqual([
      "BUTTERSCOTCH_WEB", "EASYRPG_WEB", "KIRIKIRI2_WEB", "MKXP_LIBRETRO_WEB", "NATIVE_WEB", "ONS_YURI_WEB",
      "TYRANOSCRIPT_WEB", "WASM4_WEB",
    ]);
    for (const entry of runtimeAdapters) {
      expect(entry.capabilities.standardGamepad).toBe(true);
      expect(entry.capabilities.checkpoint).toBe(true);
      expect(entry.capabilities.contentSources.length).toBeGreaterThan(0);
      expect(entry.checkpointFormat).toMatch(/^[a-z0-9][a-z0-9.-]{0,63}$/u);
    }
  });
});
