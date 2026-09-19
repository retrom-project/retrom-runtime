// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {blockingRead, controls, createSyncBuffer, closeSyncBuffer, controlBytes, State} from "./blocking.js";
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
function options() {
  const buffer = createSyncBuffer(1), control = controls(buffer), output = new Uint8Array(3);
  return {buffer, epoch: 1, requestId: 1, length: 3, timeoutMs: 100,
    send: vi.fn(() => {new Uint8Array(buffer, controlBytes, 3).set([7, 8, 9]); Atomics.store(control, 4, 3); Atomics.store(control, 0, State.OK);}),
    acknowledge: vi.fn(), cancel: vi.fn(), consume: vi.fn((bytes: Uint8Array) => output.set(bytes)), output};
}
it("[BR-02] UNIT/main-thread forbids blocking before invoking Atomics.wait", () => {
  vi.stubGlobal("document", {}); const wait = vi.spyOn(Atomics, "wait"), value = options();
  expect(() => blockingRead(value)).toThrow("SOURCE_INVALID"); expect(wait).not.toHaveBeenCalled(); expect(value.send).not.toHaveBeenCalled();
});
it("[IO-22] UNIT/sync-copy [BR-10] UNIT/sync-copy copies output before releasing the shared slot", () => {
  const value = options(); blockingRead(value); expect(value.output).toEqual(new Uint8Array([7, 8, 9]));
  new Uint8Array(value.buffer, controlBytes, 3).fill(0); expect(value.output).toEqual(new Uint8Array([7, 8, 9]));
  expect(value.acknowledge).toHaveBeenCalledOnce(); expect(Atomics.load(controls(value.buffer), 0)).toBe(State.IDLE);
});
it("[BR-03] UNIT/sync-deadline permanently closes an unresponsive service without a Worker error event", () => {
  const value = options(); value.send.mockImplementation(() => {});
  vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(101);
  expect(() => blockingRead(value)).toThrow("TIMEOUT"); expect(value.cancel).toHaveBeenCalledOnce();
  expect(() => blockingRead({...value, requestId: 2})).toThrow("TIMEOUT"); expect(value.send).toHaveBeenCalledOnce();
});
it("[X-23] UNIT/sync-error reads the error from shared memory without dispatching consumer message callbacks", () => {
  const value = options(); value.send.mockImplementation(() => closeSyncBuffer(value.buffer, 5));
  expect(() => blockingRead(value)).toThrow("IDENTITY_CHANGED"); expect(value.consume).not.toHaveBeenCalled();
  expect(value.acknowledge).not.toHaveBeenCalled(); expect(value.cancel).toHaveBeenCalledOnce();
});
for (const invalid of ["epoch", "sequence", "length"] as const) {
  it(`[BR-11] UNIT/sync-${invalid} rejects an incompatible reply before copying bytes`, () => {
    const value = options(), send = value.send.getMockImplementation()!;
    value.send.mockImplementation(() => {send(); Atomics.store(controls(value.buffer), {epoch: 3, sequence: 2, length: 4}[invalid], 2);});
    expect(() => blockingRead(value)).toThrow(invalid === "epoch" ? "ABI_MISMATCH" : "RANGE_INVALID");
    expect(value.consume).not.toHaveBeenCalled(); expect(Atomics.load(controls(value.buffer), 0)).toBe(State.CLOSED);
  });
}
it("[BR-09] UNIT/sync-close repeated close retains the first cause and never reopens the slot", () => {
  const value = options(); closeSyncBuffer(value.buffer, 5); closeSyncBuffer(value.buffer, 11);
  expect(() => blockingRead(value)).toThrow("IDENTITY_CHANGED"); expect(value.send).not.toHaveBeenCalled();
});
