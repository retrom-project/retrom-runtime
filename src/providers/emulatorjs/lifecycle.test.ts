import {afterEach, describe, expect, it, vi} from "vitest";

import type {RuntimeEventV1, RuntimeHostV1} from "../../provider/module-api.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

const digest = "a".repeat(64);
const assetIndex = {
  "assets/4.2.3/data/cores/fceumm-wasm.data": {
    sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
    sizeBytes: 1054015,
  },
  "assets/4.2.3/data/cores/ppsspp-thread-wasm.data": {
    sha256: "cb46c33a3a8444b707f7a03fe00414d916ab55a41e85fbf0c59611aa643252da",
    sizeBytes: 4581537,
  },
  "assets/4.2.3/data/cores/beetle_vb-wasm.data": {
    sha256: "3db727a78b6a6551a4024c273069eb39c8e8f33aa78ef16a073ed7460f6ce692",
    sizeBytes: 858313,
  },
};

afterEach(() => {vi.useRealTimers();});

describe("EmulatorJS provider lifecycle boundaries", () => {
  it("waits for restore, publishes checkpoint availability and forwards core exit once", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.fetch = vi.fn(async () => new Response("ok"));
    const restore = new Uint8Array([7, 8, 9]);
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => restore),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(), signal: new AbortController().signal,
    };
    const envelope = launchEnvelope();
    envelope.restore = {format: "emulatorjs-state-v1", sha256: digest, sizeBytes: 3, url: "/runtime/restore"};
    const player = await createEmulatorJsPlayer(envelope, host, assetIndex);
    const received: RuntimeEventV1[] = [];
    player.subscribe((event) => received.push(event));
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    expect(runtimeWindow.document.querySelector("#retrom-emulator")?.tagName).toBe("DIV");
    let finishRestore: (() => void) | undefined;
    const loadExplicitStateAndWait = vi.fn(() => new Promise<void>((resolve) => {finishRestore = resolve;}));
    const toggleMainLoop = vi.fn();
    let onExit: (() => void) | undefined;
    runtimeWindow.EJS_emulator = {
      gameManager: {loadExplicitStateAndWait, toggleMainLoop},
      on: (event: string, callback: () => void) => {if (event === "exit") {onExit = callback;}},
    };
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await vi.waitFor(() => expect(loadExplicitStateAndWait).toHaveBeenCalledWith(restore));
    expect(player.getState()).toBe("MOUNTING");
    expect(received).toContainEqual({
      type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: {available: true, reason: null},
    });
    finishRestore?.();
    await mounting;
    expect(toggleMainLoop).toHaveBeenCalledWith(true);
    onExit?.();
    onExit?.();
    expect(received.filter((event) => event.type === "EXIT_REQUESTED")).toHaveLength(1);
  });

  it("fails the start barrier at exactly thirty seconds and clears the fake clock", async () => {
    vi.useFakeTimers();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(), signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, assetIndex);
    const mounting = player.mount(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(player.getState()).toBe("MOUNTING");
    const failure = expect(mounting).rejects.toMatchObject({code: "PLAYER_RUNTIME_START_TIMEOUT"});
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(player.getState()).toBe("FAILED");
    expect(vi.getTimerCount()).toBe(0);
    expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).toBeNull();
  });

  it("publishes checkpoint readiness when the manager appears only at game start", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(), signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, assetIndex);
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    const instance: {gameManager?: {getState: () => Uint8Array}} = {};
    runtimeWindow.EJS_emulator = instance;
    (runtimeWindow.EJS_ready as () => void)();
    expect(player.getCheckpointAvailability()).toEqual({available: false, reason: "NOT_READY"});
    instance.gameManager = {getState: () => new Uint8Array([1])};
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(player.getCheckpointAvailability()).toEqual({available: true, reason: null});
    expect(events).toContainEqual({
      type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: {available: true, reason: null},
    });
  });

  it.each([
    {targetId: "ppsspp", presses: [[2000, 0], [5000, 0]]},
    {targetId: "beetle-vb", presses: [[2000, 0], [4000, 3], [15000, 3], [25000, 3]]},
  ])("preserves the $targetId manager receiver for every startup press and release", async ({targetId, presses}) => {
    vi.useFakeTimers();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(), signal: new AbortController().signal,
    };
    const envelope = launchEnvelope();
    envelope.runtime.targetId = targetId;
    const player = await createEmulatorJsPlayer(envelope, host, assetIndex);
    const mounting = player.mount(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(0);
    const nativeInput = vi.fn();
    const manager = {
      EJS: {isNetplay: false},
      functions: {simulateInput: nativeInput},
      simulateInput(player: number, control: number, value: number) {
        if (!this.EJS.isNetplay) {this.functions.simulateInput(player, control, value);}
      },
    };
    runtimeWindow.EJS_emulator = {gameManager: manager};
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(nativeInput).not.toHaveBeenCalled();
    let elapsed = 0;
    for (const [delay, control] of presses) {
      await vi.advanceTimersByTimeAsync(delay - elapsed - 1);
      const previousCalls = nativeInput.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(nativeInput.mock.calls.slice(previousCalls)).toEqual([[0, control, 1]]);
      await vi.advanceTimersByTimeAsync(120);
      expect(nativeInput.mock.calls.slice(previousCalls)).toEqual([[0, control, 1], [0, control, 0]]);
      elapsed = delay + 120;
    }
    expect(player.getState()).toBe("RUNNING");
    expect(vi.getTimerCount()).toBe(0);
    await player.exit();
    frame.remove();
  });

  it("clears delayed startup controls when the host aborts", async () => {
    vi.useFakeTimers();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const controller = new AbortController();
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(), signal: controller.signal,
    };
    const envelope = launchEnvelope();
    envelope.runtime.targetId = "ppsspp";
    const player = await createEmulatorJsPlayer(envelope, host, assetIndex);
    const mounting = player.mount(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(0);
    const simulateInput = vi.fn();
    runtimeWindow.EJS_emulator = {gameManager: {simulateInput}};
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(vi.getTimerCount()).toBe(2);
    controller.abort();
    await player.exit();
    expect(player.getState()).toBe("EXITED");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(simulateInput).not.toHaveBeenCalled();
  });
});
