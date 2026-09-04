import { afterEach, describe, expect, it, vi } from "vitest";
import { GameRuntimeController } from "./controller.js";
import type {
  CheckpointAvailability,
  GameRuntimeEvent,
  RuntimeCapabilities,
  RuntimeCheckpoint,
} from "./contract.js";
import type { MountedRuntimeAdapter } from "./internal-adapter.js";

afterEach(() => vi.useRealTimers());

const capabilities: RuntimeCapabilities = {
  checkpoint: true,
  contentSources: ["FILE_TREE"],
  frameCounter: true,
  pause: true,
  screenshot: true,
  standardGamepad: true,
  validationProbes: ["test.position.v1"],
  volume: true,
};

function adapterFixture(overrides: Partial<MountedRuntimeAdapter> = {}) {
  const availability: CheckpointAvailability = { available: true, blocker: null };
  return {
    checkpoint: vi.fn(async (): Promise<RuntimeCheckpoint> => ({
      bytes: Uint8Array.of(1, 2, 3), format: "test-state-v1",
    })),
    exit: vi.fn(async () => undefined),
    getCanvas: () => document.createElement("canvas"),
    getCheckpointAvailability: () => availability,
    getFrameCount: () => 300,
    getValidationProbe: (kind) => kind === "test.position.v1"
      ? { kind, schemaVersion: 1, value: { x: 2, y: 3 } }
      : null,
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Blob([Uint8Array.of(1)], { type: "image/png" })),
    setVolume: vi.fn(),
    ...overrides,
  } satisfies MountedRuntimeAdapter;
}

function runtimeFixture(adapter: MountedRuntimeAdapter, signal: AbortSignal | null = null) {
  return new GameRuntimeController(async () => adapter, capabilities, signal);
}

describe("GameRuntimeController", () => {
  it("enforces the lifecycle and normalizes checkpoint/screenshot access", async () => {
    const adapter = adapterFixture();
    const events: GameRuntimeEvent[] = [];
    const runtime = runtimeFixture(adapter);
    runtime.subscribe((event) => events.push(event));

    await runtime.mount(document.createElement("div"));
    expect(runtime.getState()).toBe("RUNNING");
    expect(events.some((event) => event.type === "READY")).toBe(true);
    await expect(runtime.mount(document.createElement("div"))).rejects.toThrow("RUNTIME_INVALID_STATE");

    await runtime.pause();
    expect(runtime.getState()).toBe("PAUSED");
    await runtime.resume();
    expect(runtime.getState()).toBe("RUNNING");
    const checkpoint = await runtime.checkpoint();
    expect(checkpoint).toEqual({ bytes: Uint8Array.of(1, 2, 3), format: "test-state-v1" });
    expect(await runtime.screenshot()).toMatchObject({ size: 1, type: "image/png" });
    expect(runtime.getFrameCount()).toBe(300);
    expect(runtime.getValidationProbe("test.position.v1")).toEqual({
      kind: "test.position.v1", schemaVersion: 1, value: { x: 2, y: 3 },
    });
    runtime.setVolume(0.5);
    expect(adapter.setVolume).toHaveBeenCalledWith(0.5);

    await Promise.all([runtime.exit(), runtime.exit()]);
    expect(runtime.getState()).toBe("EXITED");
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("turns a core-initiated exit into one host event and disables checkpoints immediately", async () => {
    const adapter = adapterFixture();
    const events: GameRuntimeEvent[] = [];
    let requestCoreExit: (() => void) | undefined;
    const runtime = new GameRuntimeController(
      async (_target, _progress, reportExitRequested?: () => void) => {
        requestCoreExit = reportExitRequested;
        return adapter;
      },
      capabilities,
      null,
    );
    runtime.subscribe((event) => events.push(event));
    await runtime.mount(document.createElement("div"));

    requestCoreExit?.();
    requestCoreExit?.();

    await vi.waitFor(() => expect(runtime.getState()).toBe("EXITED"));
    expect(events.filter((event) => event.type === "EXIT_REQUESTED")).toHaveLength(1);
    expect(runtime.getCheckpointAvailability()).toEqual({ available: false, blocker: "NOT_READY" });
    await expect(runtime.checkpoint()).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("rejects unavailable checkpoints without calling the adapter or failing the runtime", async () => {
    const checkpoint = vi.fn(async (): Promise<RuntimeCheckpoint> => ({
      bytes: Uint8Array.of(1), format: "test-state-v1",
    }));
    const adapter = adapterFixture({
      checkpoint,
      getCheckpointAvailability: () => ({ available: false, blocker: "BUSY" }),
    });
    const runtime = runtimeFixture(adapter);
    await runtime.mount(document.createElement("div"));

    await expect(runtime.checkpoint()).rejects.toThrow("CHECKPOINT_UNAVAILABLE");
    expect(checkpoint).not.toHaveBeenCalled();
    expect(runtime.getState()).toBe("RUNNING");
    await runtime.exit();
  });

  it("returns to the prior state after a checkpoint error", async () => {
    const adapter = adapterFixture({checkpoint: vi.fn(async () => {throw new Error("CHECKPOINT_CREATE_FAILED");})});
    const runtime = runtimeFixture(adapter);
    await runtime.mount(document.createElement("div"));
    await runtime.pause();

    await expect(runtime.checkpoint()).rejects.toThrow("CHECKPOINT_CREATE_FAILED");
    expect(runtime.getState()).toBe("PAUSED");
    await runtime.exit();
  });

  it("serializes a pending pause before creating a checkpoint", async () => {
    let finishPause: (() => void) | undefined;
    const pause = vi.fn(() => new Promise<void>((resolve) => {finishPause = resolve;}));
    const checkpoint = vi.fn(async (): Promise<RuntimeCheckpoint> => ({
      bytes: Uint8Array.of(4, 5, 6), format: "test-state-v1",
    }));
    const adapter = adapterFixture({checkpoint, pause});
    const runtime = runtimeFixture(adapter);
    await runtime.mount(document.createElement("div"));

    const pausing = runtime.pause();
    const saving = runtime.checkpoint();
    await Promise.resolve();
    expect(checkpoint).not.toHaveBeenCalled();
    finishPause?.();

    await pausing;
    await expect(saving).resolves.toEqual({bytes: Uint8Array.of(4, 5, 6), format: "test-state-v1"});
    expect(runtime.getState()).toBe("PAUSED");
    await runtime.exit();
  });

  it("fails closed and cleans the adapter when an active lifecycle operation fails", async () => {
    const adapter = adapterFixture({pause: vi.fn(async () => {throw new Error("third party failure");})});
    const events: GameRuntimeEvent[] = [];
    const runtime = runtimeFixture(adapter);
    runtime.subscribe((event) => events.push(event));
    await runtime.mount(document.createElement("div"));

    await expect(runtime.pause()).rejects.toThrow("RUNTIME_FAILED");
    expect(runtime.getState()).toBe("FAILED");
    expect(adapter.exit).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: "FATAL_ERROR", code: "RUNTIME_FAILED" });
    await runtime.exit();
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("preserves a stable TyranoScript adapter error for host diagnostics", async () => {
    const adapter = adapterFixture({pause: vi.fn(async () => {throw new Error("TYRANOSCRIPT_RUNTIME_TIMEOUT");})});
    const runtime = runtimeFixture(adapter);
    await runtime.mount(document.createElement("div"));

    await expect(runtime.pause()).rejects.toThrow("TYRANOSCRIPT_RUNTIME_TIMEOUT");
    expect(runtime.getState()).toBe("FAILED");
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("cleans an adapter that completes mounting after cancellation", async () => {
    const abort = new AbortController();
    const adapter = adapterFixture();
    let finishMount: ((adapter: MountedRuntimeAdapter) => void) | undefined;
    const runtime = new GameRuntimeController(
      () => new Promise((resolve) => {finishMount = resolve;}), capabilities, abort.signal,
    );
    const mounting = runtime.mount(document.createElement("div"));
    abort.abort();
    finishMount?.(adapter);

    await expect(mounting).rejects.toMatchObject({ name: "AbortError" });
    await runtime.exit();
    expect(adapter.exit).toHaveBeenCalledOnce();
    expect(runtime.getState()).toBe("EXITED");
  });

  it("lets exit win a pending checkpoint without an illegal follow-up transition", async () => {
    let finishCheckpoint: ((payload: RuntimeCheckpoint) => void) | undefined;
    const adapter = adapterFixture({
      checkpoint: () => new Promise((resolve) => {finishCheckpoint = resolve;}),
    });
    const runtime = runtimeFixture(adapter);
    await runtime.mount(document.createElement("div"));
    const checkpoint = runtime.checkpoint();
    const exiting = runtime.exit();
    finishCheckpoint?.({bytes: Uint8Array.of(1), format: "test-state-v1"});

    await expect(checkpoint).rejects.toMatchObject({name: "AbortError"});
    await exiting;
    expect(runtime.getState()).toBe("EXITED");
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("publishes live availability changes and stops polling on exit", async () => {
    vi.useFakeTimers();
    let availability: CheckpointAvailability = {available: false, blocker: "BUSY"};
    const getAvailability = vi.fn(() => availability);
    const adapter = adapterFixture({getCheckpointAvailability: getAvailability});
    const events: GameRuntimeEvent[] = [];
    const runtime = runtimeFixture(adapter);
    runtime.subscribe((event) => events.push(event));
    await runtime.mount(document.createElement("div"));
    availability = {available: true, blocker: null};

    await vi.advanceTimersByTimeAsync(250);
    expect(events).toContainEqual({
      type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: {available: true, blocker: null},
    });
    await runtime.exit();
    const callsAfterExit = getAvailability.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getAvailability).toHaveBeenCalledTimes(callsAfterExit);
  });
});
