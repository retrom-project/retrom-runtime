// @vitest-environment node
import {expect, it, vi} from "vitest";
import {MessageChannel} from "node:worker_threads";
import {setImmediate} from "node:timers/promises";
import {SyncConsumerService} from "./sync-service.js";
import {createSyncBuffer, controls, controlBytes, State, slotBytes} from "./blocking.js";
import {base} from "./protocol.js";
import {BlockPool} from "../block-pool.js";
import {RangeReader} from "../range-reader.js";
import {BLOCK_BYTES} from "../source.js";
function fixture() {
  const pair = new MessageChannel(), buffer = createSyncBuffer(1);
  const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
  const pool = new BlockPool(0, async () => new Uint8Array(BLOCK_BYTES).fill(73));
  const object = {key: "a".repeat(64), state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}, source: {
    identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: BLOCK_BYTES, url: "https://example.test/game", purpose: "GAME",
    transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const};
  const reader = new RangeReader(crypto.randomUUID(), object, pool);
  let released!: () => void; const closed = new Promise<void>(resolve => {released = resolve;});
  const service = new SyncConsumerService(pair.port1 as unknown as MessagePort, address, reader, buffer, object.key, pool.credits, released);
  const request = () => {
    const control = controls(buffer); Atomics.store(control, 2, 1); Atomics.store(control, 7, BLOCK_BYTES); Atomics.store(control, 0, State.REQUESTED);
    pair.port2.postMessage({...base(address, 1), type: "READ", fileId: reader.id, offset: 0, length: BLOCK_BYTES, timeoutMs: 15000});
  };
  const close = async () => {service.close(); pair.port2.close(); await reader.close(); pool.close();};
  return {pair, buffer, reader, service, pool, request, close, closed};
}
for (const point of ["before-copy", "before-publish"] as const) {
  it(`[X-14] UNIT/${point} permanent close cannot be overwritten by a late synchronous result`, async () => {
    const f = fixture(), next = fixture();
    try {
      if (point === "before-copy") {
        const read = f.reader.readInto.bind(f.reader);
        vi.spyOn(f.reader, "readInto").mockImplementation(async (...args) => {const count = await read(...args); f.service.close(); return count;});
      } else {
        const exchange = Atomics.compareExchange;
        vi.spyOn(Atomics, "compareExchange").mockImplementation((array, index, expected, replacement) => {
          if (array.buffer === f.buffer && index === 0 && Number(replacement) === State.OK) {f.service.close();}
          return exchange(array, index, expected, replacement);
        });
      }
      f.request(); await f.closed; await setImmediate();
      expect(Atomics.load(controls(f.buffer), 0)).toBe(State.CLOSED);
      expect(new Uint8Array(f.buffer, controlBytes).every(value => value === (point === "before-copy" ? 0 : 73))).toBe(true);
      expect(f.pool.credits.stats).toMatchObject({temporaryBytes: 0, outputBytes: 0}); expect(f.service.stats.pending).toBe(0);
      expect(next.buffer.byteLength).toBe(slotBytes); expect(next.buffer).not.toBe(f.buffer);
      expect(Atomics.load(controls(next.buffer), 0)).toBe(State.IDLE);
      expect(new Uint8Array(next.buffer, controlBytes).every(value => value === 0)).toBe(true);
      let completed!: () => void; const ready = new Promise<void>(resolve => {completed = resolve;});
      const read = next.reader.readInto.bind(next.reader);
      vi.spyOn(next.reader, "readInto").mockImplementation(async (...args) => {const count = await read(...args); completed(); return count;});
      next.request(); await ready; await setImmediate();
      expect(Atomics.load(controls(next.buffer), 0)).toBe(State.OK);
      expect(new Uint8Array(next.buffer, controlBytes).every(value => value === 73)).toBe(true);
      expect(Atomics.load(controls(f.buffer), 0)).toBe(State.CLOSED);
    } finally {vi.restoreAllMocks(); await f.close(); await next.close();}
  });
}
