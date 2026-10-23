// @vitest-environment node
import {expect, it, vi} from "vitest";
import {MessageChannel} from "node:worker_threads";
import {SyncConsumerService} from "./sync-service.js";
import {blockingRead, createSyncBuffer, controls, controlBytes, State, TransientSlotError} from "./blocking.js";
import {base} from "./protocol.js";
import {BlockPool} from "../block-pool.js";
import {ContentIOError, errorNumbers} from "../errors.js";
import {RangeReader} from "../range-reader.js";
import {BLOCK_BYTES} from "../source.js";

function fixture(failures: number) {
  const pair = new MessageChannel(), buffer = createSyncBuffer(1), control = controls(buffer);
  const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
  let calls = 0;
  const pool = new BlockPool(0, async () => {
    if (calls++ < failures) {throw new ContentIOError("TIMEOUT");}
    return new Uint8Array(BLOCK_BYTES).fill(73);
  });
  const object = {key: "a".repeat(64), state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}, source: {
    identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: BLOCK_BYTES, url: "https://example.test/game", purpose: "GAME",
    transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"} as const};
  const reader = new RangeReader(crypto.randomUUID(), object, pool);
  const network = vi.fn<(objectKey: string, codeNumber: number) => void>();
  const service = new SyncConsumerService(pair.port1 as unknown as MessagePort, address, reader, buffer, object.key, pool.credits, () => {}, network);
  const request = (id: number) => {
    Atomics.store(control, 2, id); Atomics.store(control, 7, BLOCK_BYTES); Atomics.store(control, 0, State.REQUESTED);
    pair.port2.postMessage({...base(address, id), type: "READ", fileId: reader.id, offset: 0, length: BLOCK_BYTES, timeoutMs: 15000});
  };
  const close = async () => {service.close(); pair.port2.close(); await reader.close(); pool.close();};
  return {buffer, control, network, request, close, objectKey: object.key};
}

it("[NET-06] UNIT/a transient synchronous read leaves the channel open and the slot retryable", async () => {
  const f = fixture(1);
  try {
    f.request(1);
    await vi.waitFor(() => expect(Atomics.load(f.control, 0)).toBe(State.ERROR));
    expect(Atomics.load(f.control, 4)).toBe(errorNumbers.TIMEOUT);
    expect(Atomics.load(f.control, 6)).toBe(0);
    expect(f.network).toHaveBeenCalledWith(f.objectKey, errorNumbers.TIMEOUT);
    // The consumer returns the slot to IDLE and sends the next request for the same block.
    expect(Atomics.compareExchange(f.control, 0, State.ERROR, State.IDLE)).toBe(State.ERROR);
    f.request(2);
    await vi.waitFor(() => expect(Atomics.load(f.control, 0)).toBe(State.OK));
    expect(new Uint8Array(f.buffer, controlBytes, BLOCK_BYTES).every(value => value === 73)).toBe(true);
    expect(f.network.mock.calls).toEqual([[f.objectKey, errorNumbers.TIMEOUT], [f.objectKey, 0]]);
  } finally {await f.close();}
});

function slot(code: number) {
  const buffer = createSyncBuffer(1), control = controls(buffer);
  const read = () => blockingRead({buffer, epoch: 1, requestId: 1, length: 16, timeoutMs: 1000,
    send: () => {Atomics.store(control, 4, code); Atomics.store(control, 0, State.ERROR);},
    acknowledge: () => {}, cancel: () => {}, consume: () => {}});
  return {control, read};
}

it("[NET-07] UNIT/the consumer retries transient slot errors and still closes the channel for others", () => {
  for (const code of [errorNumbers.TIMEOUT, errorNumbers.NETWORK_FAILED]) {
    const {control, read} = slot(code);
    expect(read).toThrow(TransientSlotError);
    expect(Atomics.load(control, 0)).toBe(State.IDLE); expect(Atomics.load(control, 6)).toBe(0);
  }
  const {control, read} = slot(errorNumbers.IDENTITY_CHANGED);
  expect(read).toThrow(ContentIOError); expect(read).not.toThrow(TransientSlotError);
  expect(Atomics.load(control, 0)).toBe(State.CLOSED);
});
