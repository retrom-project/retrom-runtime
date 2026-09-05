import {afterEach, describe, expect, it, vi} from "vitest";
import {mkxpStatus, waitForMkxpFrame, waitForMkxpRestore} from "./status.js";

afterEach(() => {vi.useRealTimers();});

function coreStatus() {
  vi.useFakeTimers();
  const value = {frames: 0, restore: 0};
  const status = mkxpStatus({
    _runtime_get_frame_count: () => value.frames,
    _runtime_get_restore_result: () => value.restore,
    _runtime_request_exit: () => undefined,
  });
  return {value, status};
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

  it("does not mistake advancing frames for a completed restore", async () => {
    const {value, status} = coreStatus();
    const result = waitForMkxpRestore(status).catch((error: unknown) => error);
    value.frames = 1000;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual(new Error("RPG_CHECKPOINT_RESTORE_FAILED"));
  });

  it("waits for presentation after successful deserialization before declaring ready", async () => {
    const {value, status} = coreStatus();
    let ready = false;
    const restoring = waitForMkxpRestore(status).then(() => {ready = true;});
    value.frames = 50;
    value.restore = 1;
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).toBe(false);
    value.frames = 51;
    await vi.advanceTimersByTimeAsync(50);
    await restoring;
    expect(ready).toBe(true);
  });

  it("does not declare a stalled core ready after successful deserialization", async () => {
    const {value, status} = coreStatus();
    value.restore = 1;
    value.frames = 50;
    const result = waitForMkxpRestore(status).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual(new Error("RPG_CHECKPOINT_RESTORE_FAILED"));
  });

  it("reports a core restore failure immediately", async () => {
    const {value, status} = coreStatus();
    value.restore = -1;
    await expect(waitForMkxpRestore(status)).rejects.toThrow("RPG_CHECKPOINT_RESTORE_FAILED");
  });

  it("rejects malformed native observations", () => {
    const {value, status} = coreStatus();
    value.frames = NaN;
    expect(() => status.frames()).toThrow("RPG_RUNTIME_STATE_UNAVAILABLE");
    value.restore = 2;
    expect(() => status.restoreResult()).toThrow("RPG_RUNTIME_STATE_UNAVAILABLE");
  });
});
