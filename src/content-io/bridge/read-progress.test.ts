// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {PortRPC} from "./async.js";
import {base, type Message} from "./protocol.js";
import {blockingRead, controls, createSyncBuffer, State} from "./blocking.js";

afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});
it("request-scoped byte progress renews an asynchronous read without completing its RPC", async () => {
  vi.useFakeTimers();
  const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
  const port = {postMessage: vi.fn(), start() {}, close() {}, onmessage: null as null | ((event: {data: Message}) => void), onmessageerror: null};
  const rpc = new PortRPC(port as unknown as MessagePort, address, vi.fn(), vi.fn());
  const progress = vi.fn(), fileId = crypto.randomUUID();
  const pending = rpc.request({type: "READ", fileId, offset: 0, length: 1, timeoutMs: 15000}, "READ_OK",
    {timeoutMs: 15000, progress: {fileId, advance: progress}});
  const result = expect(pending).resolves.toMatchObject({type: "READ_OK"});
  try {
    for (let n = 1; n <= 3; n++) {
      await vi.advanceTimersByTimeAsync(10_000);
      port.onmessage!({data: {...base(address, 0), type: "READ_PROGRESS", readRequestId: 1, fileId, networkBytes: n * 65536}});
      expect(rpc.stats.pending).toBe(1);
    }
    port.onmessage!({data: {...base(address, 1), type: "READ_OK", fileId, offset: 0, length: 1,
      bytes: new Uint8Array([7]).buffer, origin: "NETWORK"}});
    await result; expect(progress.mock.calls).toEqual([[65536], [65536], [65536]]);
  } finally {rpc.close();}
});
it("does not let duplicate counters or another request's data keep a stalled asynchronous read alive", async () => {
  vi.useFakeTimers();
  const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
  const port = {postMessage: vi.fn(), start() {}, close() {}, onmessage: null as null | ((event: {data: Message}) => void), onmessageerror: null};
  const rpc = new PortRPC(port as unknown as MessagePort, address, vi.fn(), vi.fn()), fileId = crypto.randomUUID();
  const read = () => rpc.request({type: "READ", fileId, offset: 0, length: 1, timeoutMs: 15000}, "READ_OK",
    {timeoutMs: 15000, progress: {fileId, advance: vi.fn()}});
  const active = read(), stalled = expect(read()).rejects.toThrow("CONTENT_IO_TIMEOUT");
  const notify = (readRequestId: number, networkBytes: number) => port.onmessage!({data: {
    ...base(address, 0), type: "READ_PROGRESS", readRequestId, fileId, networkBytes,
  }});
  try {
    notify(2, 65536);
    for (let n = 1; n <= 4; n++) {
      await vi.advanceTimersByTimeAsync(4000); notify(1, n * 65536); notify(2, 65536);
    }
    await stalled;
    expect(rpc.stats).toEqual({pending: 1, closed: false});
    port.onmessage!({data: {...base(address, 1), type: "READ_OK", fileId, offset: 0, length: 1,
      bytes: new Uint8Array([7]).buffer, origin: "NETWORK"}});
    await expect(active).resolves.toMatchObject({type: "READ_OK"});
  } finally {rpc.close();}
});
it.each([true, false])("synchronous waits renew only when their byte counter advances: %s", advances => {
  const buffer = createSyncBuffer(1), control = controls(buffer);
  let time = 0, wakes = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(Atomics, "wait").mockImplementation(() => {
    time += 4000; wakes++;
    if (wakes <= 8) {if (advances) Atomics.add(control, 4, 65536);}
    else {Atomics.store(control, 4, 1); Atomics.store(control, 0, State.OK);}
    return "ok";
  });
  const consume = vi.fn(), run = () => blockingRead({buffer, epoch: 1, requestId: 1, length: 1, timeoutMs: 15000,
    send() {}, acknowledge() {}, cancel() {}, consume});
  if (advances) {run(); expect(time).toBeGreaterThan(30_000); expect(consume).toHaveBeenCalledOnce();}
  else {expect(run).toThrow("CONTENT_IO_TIMEOUT"); expect(consume).not.toHaveBeenCalled();}
});
