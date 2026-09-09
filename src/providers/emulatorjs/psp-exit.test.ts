import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {emulatorJsProviderDefinition} from "./catalog.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {observe() {} disconnect() {}});
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren();});

describe("PSP explicit exit", () => {
  it.each(["ppsspp", "fceumm"])("preserves native cleanup for %s without rebooting PSP", async targetId => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.fetch = vi.fn(async () => new Response("ok"));
    const envelope = launchEnvelope(); envelope.runtime.targetId = targetId;
    const implementation = emulatorJsProviderDefinition.targets.find(target => target.id === targetId)!.implementation;
    const player = await createEmulatorJsPlayer(envelope, {
      loadRestore: vi.fn(async () => null), signal: new AbortController().signal, reportDiagnostic: vi.fn(),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
    }, {[implementation.coreAssetPath]: {sha256: implementation.coreSha256, sizeBytes: implementation.coreSizeBytes}});
    const mounting = player.mount(document.createElement("div")); await vi.advanceTimersByTimeAsync(0);
    const restart = vi.fn(), unmount = vi.fn(), abort = vi.fn(), toggleMainLoop = vi.fn();
    const functions = {restart};
    const callEvent = vi.fn(() => {
      // Pinned EmulatorJS GameManager resets before stopping and releasing the core.
      functions.restart(); toggleMainLoop(false); unmount();
      runtimeWindow.setTimeout(abort, 1000); return 0;
    });
    runtimeWindow.EJS_emulator = {gameManager: {functions, toggleMainLoop, simulateInput: vi.fn(), getState: () => Uint8Array.of(1)}, callEvent};
    (runtimeWindow.EJS_ready as () => void)(); (runtimeWindow.EJS_onGameStart as () => void)(); await mounting;
    const exiting = player.exit();
    expect(restart).toHaveBeenCalledTimes(targetId === "ppsspp" ? 0 : 1);
    expect(functions.restart).toBe(restart);
    expect(toggleMainLoop).toHaveBeenCalledWith(false); expect(unmount).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1100); await exiting;
    expect(abort).toHaveBeenCalledOnce(); expect(player.getState()).toBe("EXITED");
    await player.exit(); expect(callEvent).toHaveBeenCalledOnce();
  });
});
