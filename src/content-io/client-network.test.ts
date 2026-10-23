// @vitest-environment node
import {expect, it, vi} from "vitest";
import {ContentSessionClient} from "./client.js";
import {ContentIOError, errorNumbers} from "./errors.js";
import type {ContentNetworkState} from "./network-wait.js";

it("[NET-08] UNIT/synchronous channel wait and recovery diagnostics drive the session network state", () => {
  class QuietWorker extends EventTarget {postMessage() {} terminate() {}}
  vi.stubGlobal("Worker", QuietWorker);
  const states: ContentNetworkState[] = [], diagnostics = vi.fn();
  const session = new ContentSessionClient(new Worker("unused"), {storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]},
    undefined, {onNetwork: state => states.push(state), onDiagnostic: diagnostics});
  void session.ready.catch(() => {});
  const event = (codeNumber: number, objectKey: string | null, operation = "READ") => (session as unknown as {event(message: object): void}).event({
    type: "DIAGNOSTIC", operation, codeNumber, objectKey, counts: {}, sessionId: session.sessionId});
  try {
    event(0, null); event(errorNumbers.TIMEOUT, null); event(errorNumbers.NETWORK_FAILED, "a".repeat(64), "CACHE_READ");
    expect(states).toEqual([]);
    event(errorNumbers.TIMEOUT, "a".repeat(64)); event(errorNumbers.NETWORK_FAILED, "b".repeat(64));
    expect(states).toEqual(["WAITING"]);
    event(0, "a".repeat(64)); expect(states).toEqual(["WAITING"]);
    event(0, "b".repeat(64)); expect(states).toEqual(["WAITING", "RESTORED"]);
    expect(diagnostics).toHaveBeenCalledTimes(7);
    session.fail(new ContentIOError("ABORTED"));
    event(errorNumbers.TIMEOUT, "a".repeat(64)); expect(states).toEqual(["WAITING", "RESTORED"]);
  } finally {session.fail(new ContentIOError("ABORTED")); vi.unstubAllGlobals();}
});
