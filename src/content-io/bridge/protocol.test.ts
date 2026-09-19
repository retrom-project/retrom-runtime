// @vitest-environment node
import {expect, it} from "vitest";
import {MessageChannel} from "node:worker_threads";
import {base, parseBoot, parseConsumer, parseManagement, parseMessage} from "./protocol.js";
import {abi, contractSha256} from "../identity.js";
const address = {sessionId: crypto.randomUUID(), channelId: crypto.randomUUID(), epoch: 1};
const read = {...base(address, 1), type: "READ", fileId: crypto.randomUUID(), offset: 0, length: 262144, timeoutMs: 15000};
it("[BR-11] UNIT/session consumer and management capabilities have disjoint commands", () => {
  expect(parseConsumer(read, address)).toEqual(read);
  expect(() => parseManagement(read, address)).toThrow("SOURCE_INVALID");
  expect(() => parseConsumer({...base(address, 1), type: "CLOSE_SESSION"}, address)).toThrow("SOURCE_INVALID");
  for (const patch of [{url: "https://evil.test/"}, {epoch: 2}, {channelId: crypto.randomUUID()}, {requestId: 0}, {offset: 1}, {length: 262145}, {timeoutMs: 0}]) {
    expect(() => parseConsumer({...read, ...patch}, address)).toThrow("SOURCE_INVALID");
  }
});
it("[BR-12] UNIT/session shape, host objects, bytes and identifiers are exact", () => {
  const good = {...base(address, 1), type: "READ_OK", origin: "NETWORK", fileId: read.fileId, offset: 0, length: 1, bytes: new ArrayBuffer(1)};
  expect(parseMessage(good, address)).toEqual(good);
  expect(() => parseMessage({...good, bytes: {}}, address)).toThrow("SOURCE_INVALID");
  expect(() => parseMessage({...good, bytes: new ArrayBuffer(2)}, address)).toThrow("LENGTH_MISMATCH");
  expect(() => parseMessage({...good, sessionId: ""}, address)).toThrow("SOURCE_INVALID");
});
it("[PK-02] UNIT/session [BR-12] UNIT/boot boot requires a real port, correct fingerprint and exactly one global cache budget", () => {
  const {port1, port2} = new MessageChannel();
  const boot = {type: "BOOT", v: 1, abi, contractSha256, sessionId: address.sessionId, managementChannelId: address.channelId,
    managementPort: port1, storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"], fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}, l1BudgetBytes: 2097152, l2BudgetBytes: 14680064};
  try {
    expect(parseBoot(boot, contractSha256)).toEqual(boot);
    expect(() => parseBoot({...boot, contractSha256: "a".repeat(64)}, contractSha256)).toThrow("ABI_MISMATCH");
    expect(() => parseBoot({...boot, l2BudgetBytes: 16777216}, contractSha256)).toThrow("SOURCE_INVALID");
    expect(() => parseBoot({...boot, allowedOrigins: ["https://example.test/path"]}, contractSha256)).toThrow("SOURCE_INVALID");
  } finally {port1.close(); port2.close();}
});
