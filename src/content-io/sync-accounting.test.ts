// @vitest-environment node
import {readSyncMetrics} from "./sync-metrics.js";
import {expect, it, vi} from "vitest";
import {createSyncContentReader} from "./sync-client.js";
import {createSyncBuffer, controls, State} from "./bridge/blocking.js";
import {BLOCK_BYTES as B} from "./source.js";
it("[IO-23] UNIT/sync-logical-hits attributes logical slices to their service origin and flushes cumulative totals on close", () => {
  const pair = new MessageChannel(), buffer = createSyncBuffer(1), control = controls(buffer);
  const sent = vi.spyOn(pair.port1, "postMessage").mockImplementation(message => {
    if (message.type !== "READ") {return;}
    Atomics.store(control, 8, message.offset === 0 ? 2 : 1);
    Atomics.store(control, 4, message.length); Atomics.store(control, 0, State.OK);
  });
  const reader = createSyncContentReader({buffer, port: pair.port1, fileId: crypto.randomUUID(), objectKey: "a".repeat(64),
    sizeBytes: 4 * B, sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1, l1BudgetBytes: 2 * B});
  try {
    expect(reader.readInto(7, new Uint8Array(13))).toBe(13);
    expect(reader.readInto(11, new Uint8Array(17))).toBe(17);
    expect(reader.tryReadInto(15, new Uint8Array(19))).toBe(19);
    expect(reader.tryReadInto(B - 1, new Uint8Array(2))).toBeNull();
    expect(reader.readInto(B + 3, new Uint8Array(23))).toBe(23);
    reader.close();
    expect(readSyncMetrics(control)).toMatchObject({memoryHitBytes: 59, persistentHitBytes: 13, cacheBytesL1: 0, peakCacheBytesL1: 2 * B});
    expect(sent.mock.calls.at(-1)?.[0].type).toBe("CLOSE_CHANNEL");
  } finally {pair.port1.close(); pair.port2.close();}
});
