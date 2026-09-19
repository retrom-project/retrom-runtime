// @vitest-environment node
import {expect, it, vi} from "vitest";
import {ContentSessionClient} from "./client.js";
import {SerialGate} from "./gate.js";
import {ContentIOError} from "./errors.js";
it("[X-22] UNIT/sync-gate-failure releases the request deadline when acquiring the channel gate fails", async () => {
  class QuietWorker extends EventTarget {postMessage() {} terminate() {}}
  vi.useFakeTimers(); vi.stubGlobal("Worker", QuietWorker);
  const session = new ContentSessionClient(new Worker("unused"), {storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]});
  void session.ready.catch(() => {});
  try {
    const baseline = vi.getTimerCount();
    vi.spyOn(SerialGate.prototype, "acquire").mockRejectedValueOnce(new ContentIOError("ABORTED"));
    await expect(session.createSyncChannel("unused")).rejects.toThrow("ABORTED");
    expect(vi.getTimerCount()).toBe(baseline);
  } finally {session.fail(new ContentIOError("ABORTED")); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();}
});
