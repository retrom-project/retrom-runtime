import {afterEach, describe, expect, it, vi} from "vitest";
import {mkxpStatus, waitForMkxpFrame} from "./status.js";

afterEach(() => {vi.useRealTimers();});

function coreStatus() {
  vi.useFakeTimers();
  const value = {frames: 0, restore: 0, failure: 0, acceptsRequest: 1};
  const requests: number[] = [];
  const status = mkxpStatus({
    _runtime_get_frame_count: () => value.frames,
    _runtime_get_state_result: () => value.restore,
    _runtime_get_game_result: () => value.failure,
    _runtime_request_state: (operation: number) => {
      requests.push(operation);
      return value.acceptsRequest;
    },
    _runtime_request_exit: () => undefined,
  });
  return {value, status, requests};
}

describe("mkxp threaded-core status", () => {
  it("requires the core status ABI rather than falling back to fixture evidence", () => {
    for (const module of [null, {}, {_runtime_get_frame_count: () => 1}]) {
      expect(() => mkxpStatus(module)).toThrow("RPG_RUNTIME_ARTIFACT_INVALID");
    }
  });

  it("waits for a real first presentation including an interactive title scene", async () => {
    const {value, status} = coreStatus();
    let ready = false;
    const mounting = waitForMkxpFrame(status).then(() => {ready = true;});
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).toBe(false);
    value.frames = 1;
    await vi.advanceTimersByTimeAsync(50);
    await mounting;
    expect(ready).toBe(true);
  });

  it("[NET-14] counts only time without pending content reads toward the first-frame deadline", async () => {
    const {value, status} = coreStatus();
    let reading = true;
    const mounting = waitForMkxpFrame(status, 0, () => reading).catch((error: unknown) => error);
    // A read waiting for the network for longer than the deadline does not end startup.
    await vi.advanceTimersByTimeAsync(60_000);
    reading = false;
    await vi.advanceTimersByTimeAsync(29_000);
    value.frames = 1;
    await vi.advanceTimersByTimeAsync(50);
    expect(await mounting).toBeUndefined();
    const idle = waitForMkxpFrame(status, 1, () => false).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_050);
    expect(await idle).toEqual(new Error("RPG_RUNTIME_TIMEOUT"));
  });

  it("rejects malformed native observations", () => {
    const {value, status} = coreStatus();
    value.frames = NaN;
    expect(() => status.frames()).toThrow("RPG_RUNTIME_STATE_UNAVAILABLE");
  });

  it("fails a terminated game even when opening frames and an old save receipt exist", () => {
    const {value, status} = coreStatus();
    value.frames = 100;
    value.restore = 1;
    value.failure = -1;
    expect(() => status.frames()).toThrow("RPG_RUNTIME_GAME_FAILED");
    value.failure = 2;
    expect(() => status.assertHealthy()).toThrow("RPG_RUNTIME_STATE_UNAVAILABLE");
  });
});
