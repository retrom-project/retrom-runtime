import type {ContentMessageV1, ConsumerRequestV1, ManagementRequestV1, WireBaseV1, WorkerBootV1} from "../../../contracts/content-io/v1/content-io.js";
import {validateFetchPolicy} from "../fetch-policy.js";
import {fail} from "../errors.js";
import {BLOCK_BYTES, record} from "../source.js";
import {matchesMessage} from "./schema.js";
export type ReadyMessage = WireBaseV1 & {type: "READY"; abi: "content-io-v1"; contractSha256: string; backend: "OPFS" | "CACHE_BLOCKS" | "MEMORY"};
export type Message = ContentMessageV1 | ReadyMessage;
export type Address = Readonly<{sessionId: string; channelId: string; epoch: number}>;
const management = new Set(["OPEN", "NEW_CHANNEL", "PREPARE", "JOB_ACK", "JOB_RESTART_ACK", "JOB_CANCEL", "RELEASE_LEASE", "CLOSE_FILE", "CLOSE_SESSION"]);
const consumers = new Set(["READ", "READ_ACK", "SLOT_FREE", "CANCEL", "CLOSE_CHANNEL"]);
export function parseBoot(value: unknown, hash: string): WorkerBootV1 {
  if (!matchesMessage(value) || !record(value) || value.type !== "BOOT") {fail("SOURCE_INVALID");}
  const boot = value as unknown as WorkerBootV1;
  if (boot.contractSha256 !== hash) {fail("ABI_MISMATCH");}
  if (boot.l1BudgetBytes + boot.l2BudgetBytes !== 16 * 1024 * 1024) {fail("SOURCE_INVALID");}
  for (const origin of [boot.storageOrigin, ...boot.allowedOrigins]) {
    const parsed = new URL(origin);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.origin !== origin) {fail("SOURCE_INVALID");}
  }
  return {...boot, fetchPolicy: validateFetchPolicy(boot.fetchPolicy)};
}
export function parseMessage(value: unknown, address: Address): Message {
  if (!matchesMessage(value) || !record(value) || value.type === "BOOT") {fail("SOURCE_INVALID");}
  if (value.sessionId !== address.sessionId || value.channelId !== address.channelId || value.epoch !== address.epoch) {fail("SOURCE_INVALID");}
  const message = value as unknown as Message;
  if ((message.type === "READ_OK" || message.type === "JOB_CHUNK") && (message.bytes.byteLength > BLOCK_BYTES ||
    message.type === "READ_OK" && message.bytes.byteLength !== message.length)) {fail("LENGTH_MISMATCH");}
  return message;
}
export function parseManagement(value: unknown, address: Address): ManagementRequestV1 {
  const message = parseMessage(value, address);
  if (!management.has(message.type)) {fail("SOURCE_INVALID");}
  return message as ManagementRequestV1;
}
export function parseConsumer(value: unknown, address: Address): ConsumerRequestV1 {
  const message = parseMessage(value, address);
  if (!consumers.has(message.type)) {fail("SOURCE_INVALID");}
  return message as ConsumerRequestV1;
}
export function base(address: Address, requestId: number): WireBaseV1 {return {...address, v: 1, requestId};}
