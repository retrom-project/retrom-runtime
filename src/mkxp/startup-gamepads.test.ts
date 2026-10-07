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
    vi.stubGlobal("navigator", {getGamepads: () => [pad, disconnected, null]});
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
    } finally {
      window.removeEventListener("gamepadconnected", listener);
      harness.frame.remove();
    }
  });
});
