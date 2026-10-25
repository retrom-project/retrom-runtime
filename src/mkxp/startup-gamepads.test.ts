import {afterEach, describe, expect, it, vi} from "vitest";
import {mountMkxp, createHarness, mkxpConfig} from "../../tests/mkxp-adapter-fixture.js";

const originalCrossOriginIsolated = Object.getOwnPropertyDescriptor(window, "crossOriginIsolated");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalCrossOriginIsolated) {
    Object.defineProperty(window, "crossOriginIsolated", originalCrossOriginIsolated);
  } else {
    Reflect.deleteProperty(window, "crossOriginIsolated");
  }
});

describe("mkxp startup controllers", () => {
  it("registers already-connected pads after the worker installs its native listener", async () => {
    const harness = createHarness();
    const pad = {id: "standard controller", index: 0, connected: true};
    const disconnected = {id: "old controller", index: 1, connected: false};
    // The Player frame owns game input; the page realm's own pads are not the core's source.
    const frameNavigator = harness.frame.contentWindow!.navigator;
    Object.defineProperty(frameNavigator, "getGamepads", {configurable: true, value: () => [pad, disconnected, null]});
    vi.stubGlobal("navigator", {getGamepads: () => [{id: "page-only", index: 0, connected: true}]});
    const received: unknown[] = [];
    const listener = (event: Event) => {received.push((event as GamepadEvent).gamepad);};
    harness.runtime.start.mockImplementation(async () => {
      // Nostalgist's postRun can precede the pthread's input initialization.
      setTimeout(() => {
        window.addEventListener("gamepadconnected", listener);
        harness.runtime.observation.frames = 1;
      }, 100);
    });
    try {
      const mounting = mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
      await vi.advanceTimersByTimeAsync(100);
      const mounted = await mounting;
      await mounted.exit();
      expect(received).toEqual([pad]);
      expect(harness.prepareOptions?.emscriptenModule.retromGamepadNavigator).toBe(frameNavigator);
    } finally {
      window.removeEventListener("gamepadconnected", listener);
      harness.frame.remove();
    }
  });

  it("forwards Provider-made frame pad connections to the core realm until exit", async () => {
    const harness = createHarness();
    const frameWindow = harness.frame.contentWindow!;
    const received: string[] = [];
    const listener = (event: Event) => {received.push(`${event.type}:${(event as GamepadEvent).gamepad.id}`);};
    window.addEventListener("gamepadconnected", listener);
    window.addEventListener("gamepaddisconnected", listener);
    const synthetic = (type: string) => {
      const event = new (frameWindow as Window & {Event: typeof Event}).Event(type);
      Object.defineProperty(event, "gamepad", {value: {id: "touch", index: 0, connected: type === "gamepadconnected"}});
      frameWindow.dispatchEvent(event);
    };
    try {
      const mounted = await mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
      synthetic("gamepadconnected");
      synthetic("gamepaddisconnected");
      expect(received).toEqual(["gamepadconnected:touch", "gamepaddisconnected:touch"]);
      await mounted.exit();
      synthetic("gamepadconnected");
      expect(received).toHaveLength(2);
    } finally {
      window.removeEventListener("gamepadconnected", listener);
      window.removeEventListener("gamepaddisconnected", listener);
      harness.frame.remove();
    }
  });
});
