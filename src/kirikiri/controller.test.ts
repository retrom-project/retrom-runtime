import { describe, expect, it, vi } from "vitest";

import { KirikiriRuntimeController } from "./controller.js";
import type { MountedKirikiriAdapter } from "./internal-adapter.js";

function adapterFixture(overrides: Partial<MountedKirikiriAdapter> = {}): MountedKirikiriAdapter {
  return {
    checkpoint: vi.fn(async () => Uint8Array.of(1, 2, 3)),
    exit: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Blob([Uint8Array.of(1)], { type: "image/png" })),
    ...overrides,
  };
}

describe("KirikiriRuntimeController", () => {
  it("runs the lifecycle and returns semantic checkpoint bytes", async () => {
    const adapter = adapterFixture();
    const runtime = new KirikiriRuntimeController(async () => adapter, null);
    await runtime.mount(document.createElement("div"));

    expect(runtime.getState()).toBe("RUNNING");
    expect(runtime.getCheckpointAvailability()).toEqual({ available: true, reason: null });
    await runtime.pause();
    expect(runtime.getState()).toBe("PAUSED");
    expect(await runtime.checkpoint()).toEqual({
      bytes: Uint8Array.of(1, 2, 3), payloadKind: "KIRIKIRI_SAVE_BUNDLE_V1",
    });
    expect(runtime.getState()).toBe("PAUSED");
    await runtime.resume();
    await Promise.all([runtime.exit(), runtime.exit()]);
    expect(runtime.getState()).toBe("EXITED");
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("restores the active state after checkpoint creation fails", async () => {
    const adapter = adapterFixture({
      checkpoint: vi.fn(async () => {throw new Error("KIRIKIRI_CHECKPOINT_CREATE_FAILED");}),
    });
    const runtime = new KirikiriRuntimeController(async () => adapter, null);
    await runtime.mount(document.createElement("div"));

    await expect(runtime.checkpoint()).rejects.toThrow("KIRIKIRI_CHECKPOINT_CREATE_FAILED");
    expect(runtime.getState()).toBe("RUNNING");
    await runtime.exit();
  });

  it("cleans an adapter that finishes mounting after cancellation", async () => {
    const controller = new AbortController();
    const adapter = adapterFixture();
    let finishMount: ((value: MountedKirikiriAdapter) => void) | undefined;
    const runtime = new KirikiriRuntimeController(
      () => new Promise((resolve) => {finishMount = resolve;}), controller.signal,
    );
    const mounting = runtime.mount(document.createElement("div"));
    controller.abort();
    finishMount?.(adapter);

    await expect(mounting).rejects.toMatchObject({ name: "AbortError" });
    await runtime.exit();
    expect(adapter.exit).toHaveBeenCalledOnce();
    expect(runtime.getState()).toBe("EXITED");
  });
});
