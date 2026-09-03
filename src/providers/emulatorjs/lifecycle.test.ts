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
    let onExit: (() => void) | undefined;
    runtimeWindow.EJS_emulator = {
      gameManager: {loadExplicitStateAndWait},
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
