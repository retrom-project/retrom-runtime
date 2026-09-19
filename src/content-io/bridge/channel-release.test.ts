// @vitest-environment node
import {expect, it, vi} from "vitest";
import {MessageChannel} from "node:worker_threads";
import {AsyncConsumerService} from "./async-service.js";
import {PortRPC} from "./async.js";
import {base} from "./protocol.js";
import {BlockPool} from "../block-pool.js";
import {RangeReader} from "../range-reader.js";
const B = 262144;
it("[BR-08] UNIT/shared-channel-release closes the last file capability without closing its live sibling", async () => {
  const pool = new BlockPool(0, async () => new Uint8Array(B).fill(19)), pair = new MessageChannel();
  const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
  const make = () => new RangeReader(crypto.randomUUID(), {key: "a".repeat(64), state: {generation: "one", pinnedEtag: null, revoked: false}, source: {
    identity: {kind: "FILE_SHA256", sha256: "a".repeat(64)}, sizeBytes: B, url: "https://example.test/game", purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"}}, pool);
  const first = make(), second = make(), released = vi.fn(), readers = new Map([[first.id, first], [second.id, second]]);
  const service = new AsyncConsumerService(pair.port1 as unknown as MessagePort, address, readers, pool.credits, released);
  const events = vi.fn(), rpc = new PortRPC(pair.port2 as unknown as MessagePort, address, events, () => {});
  try {
    await first.close(); service.revoke(first.id); service.revoke(first.id);
    expect(released).not.toHaveBeenCalled(); expect(readers.size).toBe(2);
    const reply = await rpc.request({type: "READ", fileId: second.id, offset: 0, length: B, timeoutMs: 15000}, "READ_OK");
    expect(new Uint8Array(reply.bytes)[0]).toBe(19); expect(pool.credits.stats.outputBytes).toBe(B);
    rpc.send({...base(address, 0), type: "READ_ACK", ackRequestId: reply.requestId});
    await second.close(); service.revoke(second.id); service.revoke(second.id);
    expect(released).toHaveBeenCalledOnce(); expect(service.stats.pending).toBe(0);
    expect(pool.credits.stats).toMatchObject({temporaryBytes: 0, outputBytes: 0});
  } finally {service.close(); rpc.close(); await first.close(); await second.close(); pool.close();}
});
