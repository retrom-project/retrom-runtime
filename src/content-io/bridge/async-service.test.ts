// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {MessageChannel} from "node:worker_threads";
import {AsyncConsumerService} from "./async-service.js";
import {base} from "./protocol.js";
import {BlockPool} from "../block-pool.js";
import {RangeReader} from "../range-reader.js";
import type {ContentMessageV1} from "../../../contracts/content-io/v1/content-io.js";
afterEach(() => vi.useRealTimers());
it("[X-06] UNIT/missing-ack retains output credit until ACK deadline closes the channel", async () => {
  vi.useFakeTimers();
  const pair = new MessageChannel(), address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
  const pool = new BlockPool(0, async () => new Uint8Array(262144));
  const reader = new RangeReader(crypto.randomUUID(), {key: "a".repeat(64), state: {generation: crypto.randomUUID(), pinnedEtag: null, revoked: false}, source: {
    identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: 262144, url: "https://example.test/game", purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", }}, pool);
  const service = new AsyncConsumerService(pair.port1 as unknown as MessagePort, address, new Map([[reader.id, reader]]), pool.credits, () => {});
  const next = () => new Promise<ContentMessageV1>((resolve) => pair.port2.once("message", resolve));
  try {
    const response = next(); pair.port2.postMessage({...base(address, 1), type: "READ", fileId: reader.id, offset: 0, length: 262144, timeoutMs: 15000});
    expect((await response).type).toBe("READ_OK"); expect(pool.credits.stats.outputBytes).toBe(262144);
    await vi.advanceTimersByTimeAsync(4999); expect(pool.credits.stats.outputBytes).toBe(262144);
    const closed = next(); await vi.advanceTimersByTimeAsync(1); expect(await closed).toMatchObject({type: "CHANNEL_CLOSED", codeNumber: 9});
    expect(service.stats.pending).toBe(0); expect(pool.credits.stats).toMatchObject({outputBytes: 0, temporaryBytes: 0});
  } finally {service.close(); pair.port2.close(); await reader.close(); pool.close();}
});
